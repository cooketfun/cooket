SHELL := /bin/bash

.PHONY: help install dev-web build-web lint-web typecheck-web go-test go-build contracts-build contracts-test db-validate compose-isolation infra-up infra-down infra-status test build validate

help:
	@echo "Cooket development commands"
	@echo ""
	@echo "  make install          Install pnpm workspace dependencies"
	@echo "  make dev-web          Run Next.js development server"
	@echo "  make build-web        Build frontend"
	@echo "  make lint-web         Lint frontend"
	@echo "  make typecheck-web    Type-check frontend"
	@echo "  make go-test          Test Go services"
	@echo "  make go-build         Build Go services"
	@echo "  make contracts-build  Build Foundry contracts"
	@echo "  make contracts-test   Test Foundry contracts"
	@echo "  make infra-up         Start PostgreSQL + Redis"
	@echo "  make infra-down       Stop local infrastructure"
	@echo "  make infra-status     Show infrastructure status"
	@echo "  make test             Run baseline tests"
	@echo "  make build            Run baseline builds"
	@echo "  make validate         Run full Phase 0 baseline validation"

install:
	pnpm install

dev-web:
	pnpm dev:web

build-web:
	pnpm build:web

lint-web:
	pnpm lint:web

typecheck-web:
	pnpm typecheck:web

go-test:
	cd apps/api && go test ./...
	cd apps/indexer && go test ./...

go-build:
	cd apps/api && go build ./cmd/server
	cd apps/indexer && go build ./cmd/indexer

contracts-build:
	cd contracts && forge build

contracts-test:
	cd contracts && forge test

db-validate:
	bash db/validate.sh

compose-isolation:
	sh scripts/validate-compose-isolation.sh

infra-up:
	docker compose up -d postgres redis

infra-down:
	docker compose down

infra-status:
	docker compose ps

test: go-test contracts-test lint-web typecheck-web

build: go-build contracts-build build-web

validate: test build compose-isolation
	docker compose config >/dev/null
	@echo "Phase 0 baseline validation passed."
