FROM golang:1.26-alpine AS build

WORKDIR /src
COPY apps/realtime/go.mod ./apps/realtime/go.mod
COPY apps/realtime/go.sum ./apps/realtime/go.sum
COPY apps/realtime ./apps/realtime
WORKDIR /src/apps/realtime
RUN GOWORK=off CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/cooket-realtime .

FROM alpine:3.22
RUN apk add --no-cache ca-certificates
COPY --from=build /out/cooket-realtime /usr/local/bin/cooket-realtime
USER nobody
ENTRYPOINT ["/usr/local/bin/cooket-realtime"]
