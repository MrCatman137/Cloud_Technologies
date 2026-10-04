# Лабораторна робота №13: Декларативне розгортання застосунків у Kubernetes (Deployment та Service)

Цей проєкт демонструє декларативний підхід до оркестрації контейнеризованого застосунку в кластері Kubernetes (k3s / Rancher Desktop) за допомогою маніфестів `Deployment` та `Service` типу `NodePort`[cite: 6].

---

## 1. Опис проєкту та структура маніфестів

Маніфести розміщено в директорії `k3s/`:
* `k3s/deployment.yaml` — контролер Deployment у просторі імен `default` на 2 репліки (`replicas: 2`) з власним образом із Docker Hub `mrcatman137/web-app:latest`, відкритим портом контейнера `containerPort: 8080` та узгодженими мітками й селектором `app: lab13-web`[cite: 10].
* `k3s/service.yaml` — мережевий сервіс типу `NodePort`, який за селектором `app: lab13-web` транслює зовнішній порт ноди `nodePort: 30080` на внутрішній порт сервісу `port: 8080` та цільовий порт контейнерів `targetPort: 8080`[cite: 3].

---

## 2. Команди запуску та тестування

Команди виконуються в терміналі середовища з налаштованим `kubectl` (наприклад, `rdctl shell` або локальна консоль у директорії `Lab_13/`)[cite: 6]:

1. Створення каталогу та перехід у нього:
mkdir -p k3s && cd k3s

2. Клієнтська валідація маніфестів без застосування (dry-run):
kubectl apply --dry-run=client -f k3s/

3. Декларативне розгортання ресурсів у кластер:
kubectl apply -f k3s/

4. Перевірка статусу розгортання (має бути READY 2/2):
kubectl get deployment lab13-web-deployment

5. Перевірка робочого стану подів (Running для обох екземплярів):
kubectl get pods -l app=lab13-web -o wide

6. Перевірка створення мережевого сервісу (тип NodePort, порти 8080:30080):
kubectl get service lab13-web-service

7. Функціональна перевірка доступності веб-додатка за допомогою curl:
curl -i http://localhost:30080

8. Перегляд розширеної інформації та журналу подій Deployment:
kubectl describe deployment lab13-web-deployment

9. Тестування механізму самовідновлення (видалення одного поду):
kubectl delete pod $(kubectl get pods -l app=lab13-web -o jsonpath="{.items[0].metadata.name}")

10. Фіксація автоматичного перестворення нової репліки:
kubectl get pods -l app=lab13-web

11. Очищення та видалення створених ресурсів:
kubectl delete -f k3s/