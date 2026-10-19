package hostidentity

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
)

// FileStore keeps each profile's Host keys in <dir>/<profile>.key, readable
// only by the owner. It is for test and development Hosts, where an OS
// credential prompt cannot be answered; production Hosts use the native store.
type FileStore struct{ dir string }

// OpenFileStore uses dir, which must be an absolute path. The directory is
// created with mode 0700 when missing.
func OpenFileStore(dir string) (Store, error) {
	if dir == "" || !filepath.IsAbs(dir) {
		return nil, fmt.Errorf("file Host key store requires an absolute key_dir")
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	info, err := os.Stat(dir)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() || (runtime.GOOS != "windows" && info.Mode().Perm()&0o077 != 0) {
		return nil, fmt.Errorf("file Host key directory %s must be a directory accessible only by its owner", dir)
	}
	return FileStore{dir: dir}, nil
}

func (s FileStore) path(profile string) (string, error) {
	if !profilePattern.MatchString(profile) {
		return "", fmt.Errorf("invalid Host key profile")
	}
	return filepath.Join(s.dir, profile+".key"), nil
}

func (s FileStore) Get(profile string) ([]byte, error) {
	path, err := s.path(profile)
	if err != nil {
		return nil, err
	}
	info, err := os.Lstat(path)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || (runtime.GOOS != "windows" && info.Mode().Perm()&0o077 != 0) {
		return nil, fmt.Errorf("Host key file %s must be a regular file readable only by its owner", path)
	}
	return os.ReadFile(path)
}

func (s FileStore) Create(profile string, data []byte) error {
	path, err := s.path(profile)
	if err != nil {
		return err
	}
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if errors.Is(err, fs.ErrExist) {
		return ErrAlreadyExists
	}
	if err != nil {
		return err
	}
	if _, err = f.Write(data); err == nil {
		err = f.Sync()
	}
	if closeErr := f.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		os.Remove(path)
	}
	return err
}

func (s FileStore) Delete(profile string) error {
	path, err := s.path(profile)
	if err != nil {
		return err
	}
	if err = os.Remove(path); errors.Is(err, fs.ErrNotExist) {
		return ErrNotFound
	}
	return err
}

// OpenConfiguredStore selects the Host key store named in configuration:
// "" or "native" for the OS credential store, "file" for FileStore in dir.
func OpenConfiguredStore(kind, collection, dir string) (Store, error) {
	switch kind {
	case "", "native":
		return OpenNativeStoreWithCollection(collection)
	case "file":
		return OpenFileStore(dir)
	default:
		return nil, fmt.Errorf("unknown Host key store %q (native or file)", kind)
	}
}
