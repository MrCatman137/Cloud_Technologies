import redis
from flask import Flask, jsonify

app = Flask(__name__)
r = redis.Redis(host='redis', port=6379, decode_responses=True)

@app.route('/')
def hello():
    try:
        visits = r.incr('counter')
        return f"<h1>Docker Compose Healthcheck Lab</h1><p>Кількість запитів до Redis: <b>{visits}</b></p>"
    except Exception as e:
        return f"<h1>Помилка підключення до бази:</h1><p>{e}</p>", 500

@app.route('/health')
def health():
    try:
        if r.ping():
            return jsonify(status="healthy", redis=True), 200
        return jsonify(status="unhealthy", redis=False), 503
    except Exception as e:
        return jsonify(status="unhealthy", error=str(e)), 503

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8080)