# Raph Reactive

**Raph Reactive** - один из частных случаев конфигурации ядра для построения систем, похожи на
vue/react signals, но с расширенными возможностями.

Является демонстрационной и не будет напрямую использоваться в продакшене.

## RaphWatch

Подписка на изменения. Внутри регистрируется в RaphRouter, и при изменениях получает уведомления.

```ts 
const w = new RaphWatch(app, 'watch1', 'user[*].profile', (evts) => {
    for (const e of evts) {
        console.log('Changed path', e.path, 'params', e.params)
    }
})

app.set('user[1].profile.name', 'Alice')
```

⸻

## Signals & Effects

Создаёт реактивное значение или подписку на эффект.
Эффект автоматически подписывается на все сигналы, которые используются внутри него.

```ts 
const count = Raph.signal(0)

Raph.effect(() => {
    console.log('Count is', count())
})
```
