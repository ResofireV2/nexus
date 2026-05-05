# Stage 1: Build
FROM elixir:1.17-alpine AS builder

RUN apk add --no-cache build-base git nodejs npm

WORKDIR /app

RUN mix local.hex --force && mix local.rebar --force

ENV MIX_ENV=prod

COPY mix.exs mix.lock ./
RUN mix deps.get --only prod
RUN mix deps.compile

COPY config/config.exs config/prod.exs config/runtime.exs ./config/
COPY lib ./lib
COPY priv ./priv
COPY assets ./assets

RUN mix assets.deploy
RUN mix compile
RUN mix release

# Stage 2: Runtime
FROM alpine:3.19 AS runtime

RUN apk add --no-cache libstdc++ openssl ncurses-libs

WORKDIR /app

RUN addgroup -S nexus && adduser -S nexus -G nexus
USER nexus

COPY --from=builder --chown=nexus:nexus /app/_build/prod/rel/nexus ./

EXPOSE 4000

ENV HOME=/app

CMD ["bin/nexus", "start"]
