package main

import (
	"context"
	"log"
	"time"

	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/nodecommand"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/runtimeadapter"
)

type commandDeliveryReader interface {
	ReadHostConnection(context.Context, string, []byte, []byte) (nodecommand.HostConnection, error)
	ReadHostCommandQueuePage(context.Context, nodecommand.HostConnection, uint64, uint64) ([]nodecommand.ChainCommandDelivery, uint64, bool, error)
}
type commandDeliveryOpener interface {
	OpenCommandDelivery(context.Context, nodecommand.ChainCommandDelivery) (nodecommand.NodeCommand, error)
}

// This consumes explicit chain delivery of original Runs, using the same
// executor as Coordinator messages. No new scheduling/authority engine, durable
// local queue, Human signing key, automatic new Run or Human KR acceptance.
func consumeChainCommandQueue(ctx context.Context, reader commandDeliveryReader, opener commandDeliveryOpener, executor runtimeCommandExecutor, org string, signing, encryption []byte) {
	var offset uint64
	var membership string
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	for {
		if ctx.Err() != nil {
			return
		}
		readCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
		connection, err := reader.ReadHostConnection(readCtx, org, signing, encryption)
		if err == nil {
			if membership != connection.MembershipID {
				membership = connection.MembershipID
				offset = 0
			}
			var rows []nodecommand.ChainCommandDelivery
			var next uint64
			var more bool
			rows, next, more, err = reader.ReadHostCommandQueuePage(readCtx, connection, offset, 32)
			cancel()
			if err == nil {
				offset = next
				if !more {
					offset = 0
				}
				for _, row := range rows {
					if ctx.Err() != nil {
						return
					}
					if time.Now().UnixMilli() >= row.Run.ExpiresAtMS {
						continue
					}
					commandCtx, stop := context.WithDeadline(ctx, time.UnixMilli(row.Run.ExpiresAtMS))
					command, openErr := opener.OpenCommandDelivery(commandCtx, row)
					if openErr != nil {
						stop()
						log.Printf("[chain-queue] original Run %s unavailable; no dispatch", row.Run.ID)
						continue
					}
					response, _, executeErr := executor.Execute(commandCtx, command)
					stop()
					code := runtimeadapter.RunErrorCode(executeErr)
					if response.Error != nil {
						code = response.Error.Code
					}
					log.Printf("[chain-queue] original Run %s state=%s code=%s", row.Run.ID, response.ExecutionState, code)
				}
			} else {
				log.Printf("[chain-queue] chain directory unavailable; no dispatch")
			}
		} else {
			cancel()
			log.Printf("[chain-queue] current Host membership unavailable; no dispatch")
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
