package main

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestStoppedReviewInputIsBoundedStrictAndRequiresOriginalRun(t *testing.T) {
	valid, _ := json.Marshal(stoppedReviewInput{ExecutionID: "0x" + strings.Repeat("a", 64)})
	if _, err := decodeStoppedReview(strings.NewReader(string(valid))); err != nil {
		t.Fatal(err)
	}
	for _, input := range []string{string(valid) + " {}", strings.TrimSuffix(string(valid), "}") + `,"unknown":true}`, `{"execution_id":"0xa","command":{}}`, string(valid) + strings.Repeat(" ", 128*1024)} {
		if _, err := decodeStoppedReview(strings.NewReader(input)); err == nil {
			t.Fatal("invalid or excessive CLI input accepted")
		}
	}
}
