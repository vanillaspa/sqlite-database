## Getting started

To install the sqlite-database into your project, simply run

```bash
npm install @vanillaspa/sqlite-database
```

## How-To

Now integrate the sqlite datebase into your app: 

```javascript
<script type="module">
  import * as sqlite from '@vanillaspa/sqlite-database';
  window.sqlite = sqlite;
</script>
```

This is only a recommendation. You can use it however you like. With the `bus` object attached to the `window` object, you have access to the event-bus in your WebComponents.

Then simply use `bus.addEventListener(type, listener)` and `bus.dispatchEvent(event)` in your WebComponents.

You are not bound to event bubbling or capturing, which are the standard event propagation mechanisms, but now you can send events even among any objects!