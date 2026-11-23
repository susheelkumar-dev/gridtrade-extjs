# GridTrade Contracts API only (zero npm dependencies). The Ext JS build needs Sencha's private npm registry, so
# the container serves the API; the converted React app is hosted by the portfolio.
FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=8080 \
    GT_LATENCY=0 \
    GT_DB_FILE=/tmp/gridtrade/db.json
WORKDIR /app
COPY server/ ./server/
RUN rm -rf ./server/data && mkdir -p /tmp/gridtrade && chown -R node:node /tmp/gridtrade
USER node
EXPOSE 8080
# The database lives in /tmp: every cold start reseeds the demo data, so visitors always see a clean dataset.
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:${PORT}/api/health || exit 1
CMD ["node", "server/server.js"]
