#!/bin/bash
# Скрипт гарантирует наличие легковесной WASM-версии ONNX Runtime без C++ компиляторов и node-gyp
set -e

echo "=== [ONNX Setup] Проверка окружения ONNX Runtime ==="

# 1. Удаляем onnxruntime-node из локальной папки node_modules (если остался от других зависимостей)
if [ -d "node_modules/onnxruntime-node" ]; then
  echo "[ONNX Setup] Обнаружен конфликтующий onnxruntime-node. Удаление директории..."
  rm -rf node_modules/onnxruntime-node
fi

# 2. Гарантируем чистое удаление из зависимостей
if grep -q '"onnxruntime-node"' package.json; then
  echo "[ONNX Setup] Обнаружен onnxruntime-node в package.json. Корректное удаление..."
  npm uninstall onnxruntime-node --no-save
fi

# 3. Принудительно ставим легковесный onnxruntime-web весом всего в несколько MB
echo "[ONNX Setup] Установка кроссплатформенного WebAssembly-пакета onnxruntime-web..."
npm install onnxruntime-web@1.20.1 --no-save --no-audit

echo "=== [ONNX Setup] Успешно завершено! Среда готова к работе (WebAssembly-only) ==="
