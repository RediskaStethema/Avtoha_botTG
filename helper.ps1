Write-Host "Choose project type: bun / node / bottg / botvk"
$type = Read-Host

# --- INIT ---
if ($type -eq "bun") {
    bun init -y
}
else {
    npm init -y
}

# --- DEPENDENCIES ---
if ($type -eq "node") {
    npm install -D typescript ts-node @types/node
}
elseif ($type -eq "bottg") {
    npm install axios node-cron node-telegram-bot-api
    npm install -D typescript ts-node @types/node @types/node-telegram-bot-api
}
elseif ($type -eq "botvk") {
    npm install vk-io axios node-cron
    npm install -D typescript ts-node @types/node
}

# --- TYPESCRIPT ---
if ($type -ne "bun") {
    npx tsc --init
}

# --- STRUCTURE ---
New-Item -ItemType Directory -Force -Path src | Out-Null
New-Item -ItemType Directory -Force -Path src/utils | Out-Null
New-Item -ItemType Directory -Force -Path src/data | Out-Null

# --- FILES ---
New-Item src/index.ts -Force | Out-Null
New-Item src/utils/tools.ts -Force | Out-Null
New-Item src/utils/constants.ts -Force | Out-Null
New-Item src/utils/types.ts -Force | Out-Null
New-Item src/data/users.json -Force | Out-Null

# --- INDEX TEMPLATE ---
@"
console.log('App started 🚀');
"@ | Set-Content src/index.ts

# --- GITIGNORE ---
@"
node_modules
dist
.env
"@ | Set-Content .gitignore

# --- PACKAGE.JSON SCRIPTS ---
if ($type -ne "bun") {
    $pkg = Get-Content package.json | ConvertFrom-Json

    $pkg.scripts = @{
        dev = "ts-node src/index.ts"
        build = "tsc"
        start = "node dist/index.js"
    }

    $pkg | ConvertTo-Json -Depth 10 | Set-Content package.json
}

Write-Host "Project ready 🚀"