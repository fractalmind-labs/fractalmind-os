package update

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/fractalmind-ai/claude-code-go/internal/install"
)

type Options struct {
	TargetArg    string
	SourceBinary string
	SourceURL    string
	Apply        bool
}

type Result struct {
	Platform          string
	ResolvedTarget    string
	CurrentExecutable string
	SourceBinary      string
	SourceURL         string
	CurrentVersion    string
	LatestVersion     string
	CheckStatus       string
	UpdateAction      string
	Applied           bool
	BackupPath        string
	BytesWritten      int64
}

func BuildResult(opts Options) (Result, error) {
	if opts.SourceBinary == "" && opts.SourceURL == "" {
		return Result{}, fmt.Errorf("source binary path or source url is required")
	}
	if opts.SourceBinary != "" && opts.SourceURL != "" {
		return Result{}, fmt.Errorf("use either source binary path or source url, not both")
	}

	plan, err := install.BuildPlan(opts.TargetArg, true)
	if err != nil {
		return Result{}, err
	}

	sourcePath, sourceURL, cleanup, err := prepareSource(opts)
	if err != nil {
		return Result{}, err
	}
	if cleanup != nil {
		defer cleanup()
	}
	latestVersion, err := fileVersion(sourcePath)
	if err != nil {
		return Result{}, err
	}

	currentVersion, targetExists, err := targetVersion(plan.ResolvedPath)
	if err != nil {
		return Result{}, err
	}

	checkStatus := "up-to-date"
	updateAction := "no replacement needed"
	if !targetExists {
		checkStatus = "update-available"
		updateAction = "target missing; run with --apply to install source binary"
	} else if currentVersion != latestVersion {
		checkStatus = "update-available"
		updateAction = "replacement available; run with --apply to install source binary"
	}

	result := Result{
		Platform:          plan.Platform,
		ResolvedTarget:    plan.ResolvedPath,
		CurrentExecutable: plan.CurrentExecutable,
		SourceBinary:      sourcePath,
		SourceURL:         sourceURL,
		CurrentVersion:    currentVersion,
		LatestVersion:     latestVersion,
		CheckStatus:       checkStatus,
		UpdateAction:      updateAction,
	}

	if opts.Apply {
		if checkStatus == "up-to-date" {
			result.UpdateAction = "already up-to-date; skipped apply"
			return result, nil
		}
		appliedPlan, err := install.ApplyFrom(sourcePath, opts.TargetArg)
		if err != nil {
			return Result{}, err
		}
		result.Applied = appliedPlan.Applied
		result.BackupPath = appliedPlan.BackupPath
		result.BytesWritten = appliedPlan.BytesWritten
		result.UpdateAction = "source binary copied into target path"
	}

	return result, nil
}

func (r Result) String() string {
	return fmt.Sprintf(
		"update_mode=%s\nplatform=%s\nresolved_install_path=%s\ncurrent_executable=%s\nsource_binary=%s\nsource_url=%s\ncurrent_version=%s\nlatest_version=%s\nversion_check_status=%s\nupdate_action=%s\nbackup_path=%s\nbytes_written=%d\napply_result=%s\n",
		updateMode(r.Applied),
		r.Platform,
		r.ResolvedTarget,
		r.CurrentExecutable,
		r.SourceBinary,
		valueOrDefault(r.SourceURL, "none"),
		r.CurrentVersion,
		r.LatestVersion,
		r.CheckStatus,
		r.UpdateAction,
		valueOrDefault(r.BackupPath, "none"),
		r.BytesWritten,
		applyResult(r.Applied),
	)
}

func targetVersion(path string) (string, bool, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return "missing", false, nil
		}
		return "", false, err
	}
	return digestVersion(data), true, nil
}

func fileVersion(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return digestVersion(data), nil
}

func digestVersion(data []byte) string {
	sum := sha256.Sum256(data)
	return "sha256:" + hex.EncodeToString(sum[:8])
}

func prepareSource(opts Options) (sourcePath string, sourceURL string, cleanup func(), err error) {
	if opts.SourceBinary != "" {
		absPath, err := filepath.Abs(opts.SourceBinary)
		if err != nil {
			return "", "", nil, err
		}
		return absPath, "", nil, nil
	}

	tmpDir, err := os.MkdirTemp("", "claude-code-go-update-*")
	if err != nil {
		return "", "", nil, err
	}
	cleanup = func() { _ = os.RemoveAll(tmpDir) }

	targetPath := filepath.Join(tmpDir, "downloaded-binary")
	if err := downloadToFile(opts.SourceURL, targetPath); err != nil {
		cleanup()
		return "", "", nil, err
	}
	return targetPath, opts.SourceURL, cleanup, nil
}

func downloadToFile(rawURL string, targetPath string) error {
	client := &http.Client{Timeout: 20 * time.Second}
	resp, err := client.Get(rawURL)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("download failed: %s", resp.Status)
	}

	out, err := os.OpenFile(targetPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755)
	if err != nil {
		return err
	}
	defer out.Close()

	if _, err := io.Copy(out, resp.Body); err != nil {
		return err
	}
	return nil
}

func updateMode(applied bool) string {
	if applied {
		return "apply"
	}
	return "check-only"
}

func applyResult(applied bool) string {
	if applied {
		return "success"
	}
	return "not-applied"
}

func valueOrDefault(v string, fallback string) string {
	if v == "" {
		return fallback
	}
	return v
}
