FROM golang:1.26-alpine AS build

WORKDIR /src
COPY apps/indexer/go.mod ./apps/indexer/go.mod
COPY apps/indexer/go.sum ./apps/indexer/go.sum
COPY apps/indexer ./apps/indexer
WORKDIR /src/apps/indexer
RUN CGO_ENABLED=0 go build -o /out/cooket-indexer ./cmd/indexer

FROM alpine:3.22
COPY --from=build /out/cooket-indexer /usr/local/bin/cooket-indexer
USER nobody
ENTRYPOINT ["/usr/local/bin/cooket-indexer"]
