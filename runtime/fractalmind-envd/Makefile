BINARY = envd
VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo "dev")
LDFLAGS = -ldflags "-X main.version=$(VERSION)"

.PHONY: build build-linux build-darwin build-windows build-all clean test run install build-sponsor run-sponsor

build:
	go build $(LDFLAGS) -o bin/$(BINARY) ./cmd/envd

build-linux:
	GOOS=linux GOARCH=amd64 go build $(LDFLAGS) -o bin/$(BINARY)-linux-amd64 ./cmd/envd

build-darwin:
	CGO_ENABLED=1 GOOS=darwin GOARCH=arm64 go build $(LDFLAGS) -o bin/$(BINARY)-darwin-arm64 ./cmd/envd

build-windows:
	CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build $(LDFLAGS) -o bin/$(BINARY)-windows-amd64.exe ./cmd/envd

# Build on macOS with Xcode command-line tools for the native Keychain bridge.
build-all: build-linux build-darwin build-windows

clean:
	rm -rf bin/

test:
	go test ./...

run: build
	./bin/$(BINARY)

install: build
	cp bin/$(BINARY) /usr/local/bin/$(BINARY)

build-sponsor:
	go build $(LDFLAGS) -o bin/sponsor-service ./cmd/sponsor-service

run-sponsor: build-sponsor
	./bin/sponsor-service
