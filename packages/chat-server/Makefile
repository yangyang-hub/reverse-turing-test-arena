.PHONY: build run dev migrate clean

build:
	go build -o bin/chat-server ./cmd/server

run: build
	./bin/chat-server

dev:
	go run ./cmd/server

migrate:
	go run ./cmd/server --migrate-only

clean:
	rm -rf bin/
