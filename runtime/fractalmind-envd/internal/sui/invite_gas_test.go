package sui

import (
	"encoding/hex"
	"strings"
	"testing"

	"github.com/mr-tron/base58"
)

// Golden bytes from @mysten/sui 2.33.1:
// tx.setSender(s); tx.setGasOwner(s); tx.setGasPrice(1000n); tx.setGasBudget(5000000n);
// tx.setGasPayment([coin 0x33.. v7, coin 0x44.. v9]); tx.setExpiration({ None: true });
// tx.transferObjects([tx.gas], tx.pure.address(r)); await tx.build()
const inviteGasGolden = "000001002022222222222222222222222222222222222222222222222222222222222222220101010001000011111111111111111111111111111111111111111111111111111111111111110233333333333333333333333333333333333333333333333333333333333333330700000000000000200000000000000000000000000000000000000000000000000000000000000000444444444444444444444444444444444444444444444444444444444444444409000000000000002001010101010101010101010101010101010101010101010101010101010101011111111111111111111111111111111111111111111111111111111111111111e803000000000000404b4c000000000000"

func goldenCoin(t *testing.T, id byte, version uint64, digest string) inviteGasCoin {
	t.Helper()
	raw, err := base58.Decode(digest)
	if err != nil || len(raw) != 32 {
		t.Fatalf("digest %q: %v", digest, err)
	}
	coin := inviteGasCoin{version: version, digest: raw}
	for i := range coin.id {
		coin.id[i] = id
	}
	return coin
}

func TestEncodeInviteGasClaimMatchesSDK(t *testing.T) {
	sender, recipient := "0x"+strings.Repeat("11", 32), "0x"+strings.Repeat("22", 32)
	coins := []inviteGasCoin{
		goldenCoin(t, 0x33, 7, "11111111111111111111111111111111"),
		goldenCoin(t, 0x44, 9, "4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi"),
	}
	raw, err := encodeInviteGasClaim(sender, recipient, coins, 1000, 5_000_000)
	if err != nil {
		t.Fatal(err)
	}
	if got := hex.EncodeToString(raw); got != inviteGasGolden {
		t.Fatalf("encoding differs from the SDK\n got %s\nwant %s", got, inviteGasGolden)
	}
}

func TestEncodeInviteGasClaimRejectsBadInput(t *testing.T) {
	sender, recipient := "0x"+strings.Repeat("11", 32), "0x"+strings.Repeat("22", 32)
	coin := goldenCoin(t, 0x33, 7, "11111111111111111111111111111111")
	for name, call := range map[string]func() error{
		"no coins": func() error { _, err := encodeInviteGasClaim(sender, recipient, nil, 1000, 1); return err },
		"short sender": func() error {
			_, err := encodeInviteGasClaim("0x11", recipient, []inviteGasCoin{coin}, 1000, 1)
			return err
		},
		"uppercase address": func() error {
			_, err := encodeInviteGasClaim(sender, strings.ToUpper(recipient), []inviteGasCoin{coin}, 1000, 1)
			return err
		},
		"zero price": func() error {
			_, err := encodeInviteGasClaim(sender, recipient, []inviteGasCoin{coin}, 0, 1)
			return err
		},
		"too many coins": func() error {
			_, err := encodeInviteGasClaim(sender, recipient, make([]inviteGasCoin, maxInviteGasCoins+1), 1000, 1)
			return err
		},
	} {
		if call() == nil {
			t.Errorf("%s: expected an error", name)
		}
	}
}
