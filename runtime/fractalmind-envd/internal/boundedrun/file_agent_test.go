package boundedrun

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestNativeFileAgentObservesRepairsAndMeasuresSequentialGoals(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "existing"), []byte("human-approved target"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "stale"), []byte("old"), 0600); err != nil {
		t.Fatal(err)
	}
	tools := openTestTools(t, dir, 7, permit)
	task, err := ParseFileTask(`{"kind":"ensure_text_files","files":[{"path":"existing","content":"human-approved target"},{"path":"stale","content":"new"},{"path":"created","content":"final"}]}`)
	if err != nil {
		t.Fatal(err)
	}
	result := RunFileGoals(context.Background(), tools, task)
	if result.Status != "submitted" || result.Used != 7 || len(result.Evidence) != 3 {
		t.Fatalf("%+v", result)
	}
	for i, evidence := range result.Evidence {
		if !evidence.Verified || evidence.ExpectedHash != evidence.ObservedHash || evidence.Path != task.Files[i].Path {
			t.Fatal("unmeasured goal advanced")
		}
	}
	for _, goal := range task.Files {
		data, err := os.ReadFile(filepath.Join(dir, goal.Path))
		if err != nil || string(data) != goal.Content {
			t.Fatal("actual goal not attained")
		}
	}
}
func TestNativeFileAgentBlocksBeforeNextGoalOnBudgetAndScope(t *testing.T) {
	dir := t.TempDir()
	tools := openTestTools(t, dir, 3, permit)
	task, err := ParseFileTask(`{"kind":"ensure_text_files","files":[{"path":"first","content":"first"},{"path":"second","content":"second"}]}`)
	if err != nil {
		t.Fatal(err)
	}
	result := RunFileGoals(context.Background(), tools, task)
	if result.Status != "blocked" || result.Reason != "budget_exhausted" || len(result.Evidence) != 1 || result.Used != 3 {
		t.Fatalf("%+v", result)
	}
	if _, err := os.Stat(filepath.Join(dir, "second")); !os.IsNotExist(err) {
		t.Fatal("second goal ran beyond budget")
	}
}
func TestTaskCannotSmuggleShellOrUnboundedGoals(t *testing.T) {
	for _, raw := range []string{`{"kind":"shell","files":[]}`, `{"kind":"ensure_text_files","files":[{"path":"../outside","content":"bad"}]}`, `{"kind":"ensure_text_files","files":[{"path":"a","content":"x"}],"command":"anything"}`, `{"kind":"ensure_text_files","files":[{"path":"a","content":"x"},{"path":"a","content":"y"}]}`} {
		if _, err := ParseFileTask(raw); err == nil {
			t.Fatal("unsafe task accepted")
		}
	}
}
