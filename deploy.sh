#!/bin/bash
echo "🔄 Atualizando código..."
git pull origin main
echo "▶ Subindo containers..."
docker compose up -d
echo "✅ Deploy finalizado!"
