FROM node:22-alpine AS build
WORKDIR /app
# better-sqlite3's shipped prebuilt binary isn't picked up in every
# musl/Alpine environment; installing the toolchain lets node-gyp compile it
# from source as a reliable fallback either way.
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/build ./build
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/drizzle ./drizzle
COPY package*.json ./
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
CMD ["node", "build"]