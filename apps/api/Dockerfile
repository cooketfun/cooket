FROM golang:1.26-alpine AS build

WORKDIR /src
COPY apps/api/go.mod ./apps/api/go.mod
COPY apps/api ./apps/api
WORKDIR /src/apps/api
RUN CGO_ENABLED=0 go build -o /out/cooket-api ./cmd/server

FROM alpine:3.22
RUN apk add --no-cache su-exec wget
COPY --from=build /out/cooket-api /usr/local/bin/cooket-api
COPY apps/api/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod 0755 /usr/local/bin/docker-entrypoint.sh
EXPOSE 4000
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["/usr/local/bin/cooket-api"]
