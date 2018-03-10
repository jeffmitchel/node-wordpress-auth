# TO INSTALL:

    npm install wordpress-auth

# TO USE:

In your init:

```javascript
  var wp_auth = require('wordpress-auth').create( {
      connection: Sequelize database connection,
      tablePrefix: Wordpress table prefix,
      siteUrl: Site URL,
      loggedInKey: LOGGED_IN_KEY from wp_config.php,
      loggedInSalt: LOGGED_IN_SALT from wp_config.php
    } );
```

When you get a HTTP request and you need to verify auth:

```javascript
  wp_auth.checkAuth( req ).on( 'auth', function( response ) {
    // response object format:
    {
      isAuthenticated: boolean,
      userId: id | 0,
      userName: name | '',
      userRole: role | '',
      error: error | undefined
    }
  } );
```
