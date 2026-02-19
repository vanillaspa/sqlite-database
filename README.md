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

This is only a recommendation. You can use it however you like. With the `sqlite` object attached to the `window` object, you have access to the sqlite-database in your WebComponents.
