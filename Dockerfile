# Use lightweight Node.js 20 Alpine image
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files first
COPY package.json package-lock.json* ./

# Install dependencies (production only)
RUN npm install --production

# Copy source code
COPY . .

# Expose port
EXPOSE 3002

# Environment variables
ENV PORT=3002
ENV NODE_ENV=production

# Start command
CMD ["node", "server.js"]
