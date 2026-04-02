# Dockerized Build Environment for Cluely Tauri App
# This container provides the necessary Node.js and Rust toolchains 
# to build the native desktop executable without polluting the host OS.

FROM rust:1.80-bullseye

# Install Node.js 20.x and necessary Linux/Tauri build dependencies
RUN apt-get update && apt-get install -y curl gnupg && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y \
    nodejs \
    build-essential \
    pkg-config \
    libwebkit2gtk-4.0-dev \
    libwebkit2gtk-4.1-dev \
    libssl-dev \
    libgtk-3-dev \
    libayatana-appindicator3-dev \
    librsvg2-dev \
    nsis \
    lld \
    llvm \
    && rm -rf /var/lib/apt/lists/*

# Add support for Windows cross-compilation (optional, for CI pipelines)
RUN rustup target add x86_64-pc-windows-msvc
RUN cargo install cargo-xwin

# Set the working directory
WORKDIR /app

# Copy dependency files and install Node modules (Tauri CLI)
COPY package.json ./
RUN npm install

# Copy the entire workspace (Subject to .dockerignore)
COPY . .

# The default command runs the Tauri build.
# This will output the built executable into src-tauri/target/release
CMD ["npm", "run", "build"]
