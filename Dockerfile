# Build reproduzível do bundle cliente/SSR; apenas artefatos necessários chegam ao runtime.
FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_PUBLIC_SITE_URL
ARG VITE_PUBLIC_SUPPORT_EMAIL
ARG VITE_PUBLIC_RESPONSE_SLA
ARG VITE_GA_MEASUREMENT_ID
ARG VITE_PUBLIC_BUSINESS_ADDRESS
ARG VITE_PUBLIC_BUSINESS_HOURS
ARG VITE_PUBLIC_GOOGLE_MAPS_URL
ARG VITE_PUBLIC_GOOGLE_MAPS_EMBED_URL
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY
ENV VITE_PUBLIC_SITE_URL=$VITE_PUBLIC_SITE_URL
ENV VITE_PUBLIC_SUPPORT_EMAIL=$VITE_PUBLIC_SUPPORT_EMAIL
ENV VITE_PUBLIC_RESPONSE_SLA=$VITE_PUBLIC_RESPONSE_SLA
ENV VITE_GA_MEASUREMENT_ID=$VITE_GA_MEASUREMENT_ID
ENV VITE_PUBLIC_BUSINESS_ADDRESS=$VITE_PUBLIC_BUSINESS_ADDRESS
ENV VITE_PUBLIC_BUSINESS_HOURS=$VITE_PUBLIC_BUSINESS_HOURS
ENV VITE_PUBLIC_GOOGLE_MAPS_URL=$VITE_PUBLIC_GOOGLE_MAPS_URL
ENV VITE_PUBLIC_GOOGLE_MAPS_EMBED_URL=$VITE_PUBLIC_GOOGLE_MAPS_EMBED_URL

COPY . .
RUN npm run build
RUN npm prune --omit=dev

# O estágio final roda sem root e sem ferramentas de build.
FROM node:22-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV NODE_OPTIONS=--enable-source-maps
ENV HOST=0.0.0.0
ENV PORT=3000

COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/src ./src
COPY --from=build --chown=node:node /app/scripts ./scripts
COPY --from=build --chown=node:node /app/tsconfig.json ./tsconfig.json

USER node
EXPOSE 3000

CMD ["node", "scripts/server.mjs"]
