package install

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"time"
)

type Plan struct {
	TargetArg         string
	RequestedPath     string
	ResolvedPath      string
	Platform          string
	CurrentExecutable string
	DryRun            bool
	WillOverwrite     bool
	OverwriteGuard    string
	BackupPath        string
	BytesWritten      int64
	Applied           bool
}

func BuildPlan(targetArg string, dryRun bool) (Plan, error) {
	resolvedPath, requestedPath, err := resolveTargetPath(targetArg)
	if err != nil {
		return Plan{}, err
	}

	currentExecutable, err := os.Executable()
	if err != nil {
		currentExecutable = "unknown"
	}

	plan := Plan{
		TargetArg:         targetArg,
		RequestedPath:     requestedPath,
		ResolvedPath:      resolvedPath,
		Platform:          runtime.GOOS + "/" + runtime.GOARCH,
		CurrentExecutable: currentExecutable,
		DryRun:            dryRun,
		WillOverwrite:     pathExists(resolvedPath),
	}
	if plan.WillOverwrite {
		plan.OverwriteGuard = "target already exists; bootstrap install will create a timestamped backup before replacing it"
	} else {
		plan.OverwriteGuard = "target does not exist; bootstrap installer will create parent directories first"
	}

	return plan, nil
}

func Apply(targetArg string) (Plan, error) {
	if targetArg == "" {
		return Plan{}, fmt.Errorf("bootstrap install --apply requires an explicit target path")
	}

	plan, err := BuildPlan(targetArg, false)
	if err != nil {
		return Plan{}, err
	}
	if plan.CurrentExecutable == "" || plan.CurrentExecutable == "unknown" {
		return Plan{}, fmt.Errorf("current executable path is unavailable")
	}
	if samePath(plan.CurrentExecutable, plan.ResolvedPath) {
		return Plan{}, fmt.Errorf("refusing to install over the currently running executable")
	}

	srcInfo, err := os.Stat(plan.CurrentExecutable)
	if err != nil {
		return Plan{}, err
	}
	if err := os.MkdirAll(filepath.Dir(plan.ResolvedPath), 0o755); err != nil {
		return Plan{}, err
	}

	tmpPath := plan.ResolvedPath + fmt.Sprintf(".tmp-%d", time.Now().UnixNano())
	bytesWritten, err := copyFile(plan.CurrentExecutable, tmpPath, srcInfo.Mode().Perm())
	if err != nil {
		_ = os.Remove(tmpPath)
		return Plan{}, err
	}

	if plan.WillOverwrite {
		plan.BackupPath = plan.ResolvedPath + time.Now().Format(".bak-20060102-150405")
		if err := os.Rename(plan.ResolvedPath, plan.BackupPath); err != nil {
			_ = os.Remove(tmpPath)
			return Plan{}, err
		}
	}

	if err := os.Rename(tmpPath, plan.ResolvedPath); err != nil {
		if plan.BackupPath != "" {
			_ = os.Rename(plan.BackupPath, plan.ResolvedPath)
		}
		_ = os.Remove(tmpPath)
		return Plan{}, err
	}

	plan.Applied = true
	plan.BytesWritten = bytesWritten
	return plan, nil
}

func ApplyFrom(sourcePath string, targetArg string) (Plan, error) {
	if sourcePath == "" {
		return Plan{}, fmt.Errorf("source binary path is required")
	}
	if targetArg == "" {
		return Plan{}, fmt.Errorf("target path is required")
	}

	plan, err := BuildPlan(targetArg, false)
	if err != nil {
		return Plan{}, err
	}

	absSource, err := filepath.Abs(sourcePath)
	if err != nil {
		return Plan{}, err
	}
	plan.CurrentExecutable = absSource

	if samePath(plan.CurrentExecutable, plan.ResolvedPath) {
		return Plan{}, fmt.Errorf("refusing to update over the same source/target path")
	}

	srcInfo, err := os.Stat(plan.CurrentExecutable)
	if err != nil {
		return Plan{}, err
	}
	if err := os.MkdirAll(filepath.Dir(plan.ResolvedPath), 0o755); err != nil {
		return Plan{}, err
	}

	tmpPath := plan.ResolvedPath + fmt.Sprintf(".tmp-%d", time.Now().UnixNano())
	bytesWritten, err := copyFile(plan.CurrentExecutable, tmpPath, srcInfo.Mode().Perm())
	if err != nil {
		_ = os.Remove(tmpPath)
		return Plan{}, err
	}

	if plan.WillOverwrite {
		plan.BackupPath = plan.ResolvedPath + time.Now().Format(".bak-20060102-150405")
		if err := os.Rename(plan.ResolvedPath, plan.BackupPath); err != nil {
			_ = os.Remove(tmpPath)
			return Plan{}, err
		}
	}

	if err := os.Rename(tmpPath, plan.ResolvedPath); err != nil {
		if plan.BackupPath != "" {
			_ = os.Rename(plan.BackupPath, plan.ResolvedPath)
		}
		_ = os.Remove(tmpPath)
		return Plan{}, err
	}

	plan.Applied = true
	plan.BytesWritten = bytesWritten
	return plan, nil
}

func (p Plan) String() string {
	return fmt.Sprintf(
		"install_mode=%s\nplatform=%s\nrequested_target=%s\nresolved_install_path=%s\ncurrent_executable=%s\nwould_overwrite=%t\noverwrite_guard=%s\nbackup_path=%s\nbytes_written=%d\napply_result=%s\n",
		boolMode(p.DryRun),
		p.Platform,
		valueOrDefault(p.RequestedPath, "default"),
		p.ResolvedPath,
		p.CurrentExecutable,
		p.WillOverwrite,
		p.OverwriteGuard,
		valueOrDefault(p.BackupPath, "none"),
		p.BytesWritten,
		applyResult(p.Applied),
	)
}

func resolveTargetPath(targetArg string) (resolvedPath string, requestedPath string, err error) {
	if targetArg != "" {
		if filepath.IsAbs(targetArg) {
			return targetArg, targetArg, nil
		}
		absPath, err := filepath.Abs(targetArg)
		if err != nil {
			return "", "", err
		}
		return absPath, targetArg, nil
	}

	switch runtime.GOOS {
	case "windows":
		localAppData := os.Getenv("LocalAppData")
		if localAppData == "" {
			home, err := os.UserHomeDir()
			if err != nil {
				return "", "", err
			}
			localAppData = filepath.Join(home, "AppData", "Local")
		}
		return filepath.Join(localAppData, "Programs", "claude-code-go", "claude-code-go.exe"), "", nil
	default:
		return "/usr/local/bin/claude-code-go", "", nil
	}
}

func pathExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func samePath(left string, right string) bool {
	l, err := filepath.Abs(left)
	if err != nil {
		l = left
	}
	r, err := filepath.Abs(right)
	if err != nil {
		r = right
	}
	return l == r
}

func boolMode(v bool) string {
	if v {
		return "dry-run"
	}
	return "apply"
}

func applyResult(applied bool) string {
	if applied {
		return "success"
	}
	return "planned"
}

func valueOrDefault(v string, fallback string) string {
	if v == "" {
		return fallback
	}
	return v
}

func copyFile(src string, dst string, mode os.FileMode) (int64, error) {
	in, err := os.Open(src)
	if err != nil {
		return 0, err
	}
	defer in.Close()

	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, mode)
	if err != nil {
		return 0, err
	}

	bytesWritten, copyErr := io.Copy(out, in)
	closeErr := out.Close()
	if copyErr != nil {
		return bytesWritten, copyErr
	}
	if closeErr != nil {
		return bytesWritten, closeErr
	}
	return bytesWritten, nil
}
