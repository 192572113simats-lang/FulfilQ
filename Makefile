.PHONY: install dev build test demo migrate seed docker-up docker-down

install:
	npm install

dev:
	npm run dev

build:
	npm run build

lint:
	npm run lint

test:
	npm test

demo:
	npm run demo:journey

migrate:
	npm run db:migrate

seed:
	npm run db:seed

docker-up:
	docker compose up --build -d

docker-down:
	docker compose down
