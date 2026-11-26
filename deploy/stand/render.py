"""Подставляет значения в docker-compose.yml стенда. Значения берутся из переменных окружения и пишутся
как JSON-строки (это корректный YAML), а $ удваивается, поэтому кавычки и спецсимволы в паролях ничего не ломают."""
import json
import os
import pathlib
import sys

src, dst = sys.argv[1], sys.argv[2]
text = pathlib.Path(src).read_text(encoding='utf-8')
keys = ['IMAGE', 'DB_PASSWORD', 'DATABASE_URL', 'AUTH_PEPPER', 'APP_URL', 'ADMIN_PHONE', 'ADMIN_PASSWORD', 'ADMIN_NAME', 'MS_TOKEN', 'MS_SYNC_HOURS', 'DOMAIN']
for k in keys:
    v = os.environ.get('STAND_' + k, '')
    # $ в docker-compose означает подстановку переменной, поэтому в значениях пишем $$.
    text = text.replace(f'__{k}__', v if k == 'DOMAIN' else json.dumps(v, ensure_ascii=False).replace('$', '$$'))
left = [w for w in text.split() if w.startswith('__') and w.endswith('__')]
if left:
    sys.exit(f'Не подставлено: {left}')
pathlib.Path(dst).write_text(text, encoding='utf-8')
