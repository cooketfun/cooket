package api

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
)

type ObjectStore interface {
	Put(context.Context, string, io.Reader) error
	Open(context.Context, string) (io.ReadCloser, error)
}

type LocalObjectStore struct{ root string }

func NewLocalObjectStore(root string) (*LocalObjectStore, error) {
	if root == "" {
		return nil, errors.New("local object storage directory is required")
	}
	if e := os.MkdirAll(root, 0o750); e != nil {
		return nil, e
	}
	return &LocalObjectStore{root: root}, nil
}
func (s *LocalObjectStore) path(key string) (string, error) {
	clean := filepath.Clean(key)
	if clean == "." || filepath.IsAbs(clean) || strings.HasPrefix(clean, "..") {
		return "", errors.New("invalid object key")
	}
	return filepath.Join(s.root, clean), nil
}
func (s *LocalObjectStore) Put(_ context.Context, key string, r io.Reader) error {
	p, e := s.path(key)
	if e != nil {
		return e
	}
	if e = os.MkdirAll(filepath.Dir(p), 0o750); e != nil {
		return e
	}
	f, e := os.OpenFile(p, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o640)
	if e != nil {
		return e
	}
	defer f.Close()
	_, e = io.Copy(f, r)
	return e
}
func (s *LocalObjectStore) Open(_ context.Context, key string) (io.ReadCloser, error) {
	p, e := s.path(key)
	if e != nil {
		return nil, e
	}
	return os.Open(p)
}
