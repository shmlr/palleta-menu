# Паллета v1.6 — Gmail → XLS → QA → PR

## Что делает робот

Каждый день в **22:23 МСК** (19:23 UTC) GitHub Actions запрашивает письмо через Gmail API format=raw, извлекает XLS из полного MIME и проверяет его локально, в приватной временной папке исполнителя. Встроенный ChatGPT Gmail Connector не скачивает octet-stream, но Gmail API RAW доступен при отдельной авторизации.

Точный отправитель: palleta.store@yandex.ru, тема: «Паллета 1С - Меню». Строго проверяются DKIM/SPF/DMARC Google, единственное вложение с датой, BIFF8/OLE, расхождение даты имени и времени Gmail максимум 120 сек, свежесть до 8 часов, полный XLS контракт, однозначный REVIEWED code pair, клубная цена и максимум 50% изменения. Допуск: сейчас только картофель. Остальные SKU, зелень без конверсии, мясо, наличие, закупочные цены, излишки, суммы, себестоимость и сам XLS не публикуются.

После успешного dry run, фактического импорта и полного Python/Node/Chrome QA Action предложит **только products.json через PR**. Никакого auto-merge/публикации без проверки владельцем. Нет нового письма: NO_NEW_REPORT, ничего не менять. Неправильное новое письмо: FAIL_CLOSED. Ни одной операции записи в 1С.

## Однократная настройка владельца

1. В Google Cloud создать личный проект и включить Gmail API. Настроить OAuth consent screen с read-only scope https://www.googleapis.com/auth/gmail.readonly, создать OAuth-клиент типа **Desktop app**. Авторизовать тот Gmail, куда приходит отчёт. Обрати внимание: Gmail readonly технически разрешает чтение всего ящика, хотя скрипт ограничивает поиск нужным отправителем.
2. OAuth-приложение для постоянной автоматизации нельзя надолго оставлять в **Testing**: у внешних приложений refresh token обычно истекает через 7 дней. Для production возможны требования проверки Google, учитывать политику Workspace API.
3. Сохранить скачанный OAuth JSON только на доверенном Windows-компьютере **вне публичного репозитория**. Выполнить:

   ~~~powershell
   py -m pip install google-auth-oauthlib==1.2.2
   py tools/gmail_oauth_once.py --client-json "D:\Secure\client_secret_google.json"
   ~~~

   Открыть разрешение Gmail в появившемся браузере. Локальный скрипт выдаст значения для GitHub Secrets. Никогда не присылать токены в чат.
4. Открыть https://github.com/shmlr/palleta-menu/settings/secrets/actions → **New repository secret**, добавить:

   - GMAIL_OAUTH_CLIENT_ID
   - GMAIL_OAUTH_CLIENT_SECRET
   - GMAIL_OAUTH_REFRESH_TOKEN

5. Репозиторий → Settings → Actions → General → Workflow permissions: разрешить создание pull requests Actions и необходимые права contents:write, pull-requests:write.
6. После ревью инфраструктурного PR и слияния в main запустить Actions → **Gmail min-max to reviewed club-price PR** → Run workflow. Расписание из feature-ветки не работает, пока workflow не попадёт в main.

## Проверка запуска

- SOURCE_VERIFIED: исходное письмо проверено, бинарный XLS находится только во временной папке runner.
- PASS_DATED_REFERENCE_ONLY: импортёр проверил реальный XLS и сохранил только разрешённые датированные справочные клубные цены.
- Все Python/Node/Chromium проверки зелёные.
- Создан PR с разницей исключительно products.json; человек просматривает цену и сливает PR.
- После слияния должен отдельно пройти обычный Pages deployment и проверка live.

**Не путать:** загрузка отчёта, PASS Python-тестов и успешная публикация GitHub Pages — три разных доказательства. До загрузки OAuth Secrets и теста с новым реальным письмом автоматизация остаётся **PENDING**, не ACTIVE.
