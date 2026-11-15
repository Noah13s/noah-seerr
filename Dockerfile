FROM node:22.23.5-alpine3.23@sha256:6868d4695b947ee120bffaa463fecd68cde370d7bfec92955e7c8ac576b4f475 AS base
ARG SOURCE_DATE_EPOCH
ARG TARGETPLATFORM
ENV TARGETPLATFORM=${TARGETPLATFORM:-linux/amd64}

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

WORKDIR /app
COPY package.json pnpm-lock.yaml .npmrc ./
COPY next.config.mjs postcss.config.js tailwind.config.js tsconfig.json seerr-api.yml ./
COPY bin ./bin
COPY public ./public
COPY src ./src
COPY server ./server

FROM base AS prod-deps

RUN --mount=type=cache,id=pnpm,target=/pnpm/store CI=true pnpm install --prod --frozen-lockfile

# Remove large native modules for linux-x64-gnu platform (we use alpine which is musl-based)
# not supported in pnpm for now due to this bug: https://github.com/pnpm/pnpm/issues/9654
RUN du -shL ./node_modules/.pnpm/* | grep '[0-9]M.*' | grep 'linux-x64-gnu@' | awk '{print $2}' | xargs rm -rf

FROM base AS build

ARG COMMIT_TAG
ENV COMMIT_TAG=${COMMIT_TAG}

RUN \
  case "${TARGETPLATFORM}" in \
  'linux/arm64' | 'linux/arm/v7') \
  apk update && \
  apk add --no-cache python3 make g++ gcc libc6-compat bash \
  ;; \
  esac

# node-gyp is a direct project dependency; native lifecycle scripts use its
# frozen-lockfile installation instead of an unpinned global npm installation.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store CYPRESS_INSTALL_BINARY=0 pnpm install --frozen-lockfile

RUN pnpm build

FROM node:22.23.5-alpine3.23@sha256:6868d4695b947ee120bffaa463fecd68cde370d7bfec92955e7c8ac576b4f475
ARG SOURCE_DATE_EPOCH
ARG COMMIT_TAG
ENV NODE_ENV=production
ENV COMMIT_TAG=${COMMIT_TAG}

RUN apk add --no-cache tzdata && \
  mkdir -p /app/config && chown node:node /app /app/config

USER node:node

WORKDIR /app

COPY --chown=node:node package.json next.config.mjs seerr-api.yml ./
COPY --chown=node:node public ./public
COPY --chown=node:node --from=prod-deps /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/.next ./.next
COPY --chown=node:node --from=build /app/dist ./dist

RUN mkdir -p config && touch config/DOCKER && \
  echo "{\"commitTag\": \"${COMMIT_TAG}\"}" > committag.json

EXPOSE 5055

CMD [ "npm", "start" ]
