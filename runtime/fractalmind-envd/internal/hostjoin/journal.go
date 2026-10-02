// Package hostjoin implements the Host admission interaction. Business state is
// read from Sui. Only an original digest and public transaction metadata go to
// the local technical journal, never invitation codes, signatures or tx bytes.
package hostjoin

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"time"

	"github.com/gofrs/flock"
	"github.com/mr-tron/base58"
)

type Record struct {
	Format         uint64 `json:"format"`
	Chain          string `json:"chain_identifier"`
	Sender         string `json:"sender"`
	Digest         string `json:"digest"`
	GasBudget      uint64 `json:"gas_budget_mist"`
	GasPrice       uint64 `json:"gas_price_mist"`
	PackageID      string `json:"package_id"`
	TypesPackageID string `json:"types_package_id"`
	OrganizationID string `json:"organization_id"`
	InviteID       string `json:"invite_id"`
}

func canonicalID(s string) bool {
	if len(s) != 66 || s[:2] != "0x" {
		return false
	}
	raw, err := hex.DecodeString(s[2:])
	return err == nil && hex.EncodeToString(raw) == s[2:]
}
func digestID(s string) bool {
	raw, err := base58.Decode(s)
	return err == nil && len(raw) == 32 && base58.Encode(raw) == s
}
func (r Record) validate(chain, sender string) error {
	if r.Format != 1 || r.Chain != chain || r.Sender != sender || !digestID(r.Chain) || !digestID(r.Digest) || !canonicalID(r.Sender) || !canonicalID(r.PackageID) || !canonicalID(r.TypesPackageID) || !canonicalID(r.OrganizationID) || !canonicalID(r.InviteID) || r.GasBudget == 0 || r.GasPrice == 0 {
		return fmt.Errorf("invalid original Host join journal; do not submit another transaction")
	}
	return nil
}

type Journal struct {
	dir, chain, sender string
	lock               *flock.Flock
}

func OpenJournal(ctx context.Context, root, chain, sender string) (*Journal, error) {
	if !digestID(chain) || !canonicalID(sender) {
		return nil, fmt.Errorf("invalid Host journal namespace")
	}
	if root == "" {
		cache, err := os.UserCacheDir()
		if err != nil {
			return nil, err
		}
		root = filepath.Join(cache, "fractalmind", "host-join-v1")
	}
	key := sha256.Sum256([]byte(chain + ":" + sender))
	dir := filepath.Join(root, hex.EncodeToString(key[:]))
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	info, err := os.Lstat(dir)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return nil, fmt.Errorf("invalid Host journal directory")
	}
	lock := flock.New(filepath.Join(dir, "operation.lock"))
	locked, err := lock.TryLockContext(ctx, 25*time.Millisecond)
	if err != nil || !locked {
		lock.Close()
		return nil, fmt.Errorf("another Host join operation is pending")
	}
	return &Journal{dir: dir, chain: chain, sender: sender, lock: lock}, nil
}
func (j *Journal) Close() error { return j.lock.Close() }
func (j *Journal) Read() (*Record, error) {
	file, err := os.Open(filepath.Join(j.dir, "pending.json"))
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, 4097))
	if err != nil || len(data) > 4096 {
		return nil, fmt.Errorf("invalid Host join journal size")
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	var record Record
	if err = decoder.Decode(&record); err != nil {
		return nil, fmt.Errorf("invalid original Host join journal; do not replay")
	}
	var extra any
	if decoder.Decode(&extra) != io.EOF {
		return nil, fmt.Errorf("trailing Host join journal data")
	}
	if err = record.validate(j.chain, j.sender); err != nil {
		return nil, err
	}
	return &record, nil
}

// WriteNew is called after explicit confirmation and signing, before broadcast.
// Never replace an unresolved pending digest. A partial/corrupt journal fails
// closed and cannot silently become permission for a new attempt.
func (j *Journal) WriteNew(record Record) error {
	if err := record.validate(j.chain, j.sender); err != nil {
		return err
	}
	if previous, err := j.Read(); err != nil {
		return err
	} else if previous != nil {
		return fmt.Errorf("original Host join digest already exists; query it first")
	}
	data, err := json.Marshal(record)
	if err != nil {
		return err
	}
	file, err := os.CreateTemp(j.dir, ".prepared-*")
	if err != nil {
		return err
	}
	name := file.Name()
	defer os.Remove(name)
	if _, err = file.Write(data); err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		return err
	}
	if err = os.Rename(name, filepath.Join(j.dir, "pending.json")); err != nil {
		return err
	}
	return j.syncDirectory()
}
func (j *Journal) syncDirectory() error {
	if runtime.GOOS == "windows" {
		return nil
	} // the file itself is flushed; native Windows durability remains an acceptance gate
	dir, err := os.Open(j.dir)
	if err != nil {
		return err
	}
	defer dir.Close()
	return dir.Sync()
}

// Archive is only called after the original chain receipt is known terminal and
// an operator explicitly requests and confirms a new attempt.
func (j *Journal) Archive(expected string) error {
	record, err := j.Read()
	if err != nil {
		return err
	}
	if record == nil || record.Digest != expected {
		return fmt.Errorf("original Host join journal changed")
	}
	destination := filepath.Join(j.dir, record.Digest+".json")
	if _, err = os.Lstat(destination); err == nil || !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("Host join archive already exists or cannot be inspected")
	}
	if err = os.Rename(filepath.Join(j.dir, "pending.json"), destination); err != nil {
		return err
	}
	return j.syncDirectory()
}
