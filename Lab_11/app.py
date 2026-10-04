import os
import redis
from flask import Flask

app = Flask(__name__)
# Підключення до redis за мережевим іменем сервісу з compose.yaml
r = redis.Redis(host='redis', port=6379, decode_responses=True)

@app.route('/')
def hello():
    try:
        visits = r.incr('counter')
        return f"<h1>Docker Compose Lab</h1><p>Кількість запитів до Redis: <b>{visits}</b></p>"
    except Exception as e:
        return f"<h1>Помилка підключення до бази:</h1><p>{e}</p>", 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8080)