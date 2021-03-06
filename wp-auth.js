var crypto = require('crypto'),
  phpjs = require('./serialize');

function sanitizeValue(value) {
  switch (typeof value) {
    case 'boolean':
    case 'object':
      return phpjs.serialize(value).replace(/(\'|\\)/g, '\\$1');
    case 'number':
      return Number.toString.call(value);
    case 'string':
      try {
        // If it's a serialized string, serialize it again so it comes back out of the database the same way.
        return phpjs
          .serialize(phpjs.serialize(phpjs.unserialize(value)))
          .replace(/(\'|\\)/g, '\\$1');
      } catch (ex) {
        return value.replace(/(\'|\\)/g, '\\$1');
      }
    default:
      throw new Error('Invalid data type: ' + typeof value);
  }
}

function WP_Auth(options) {
  var md5 = crypto.createHash('md5');
  md5.update(options.siteUrl);
  this.cookiename = 'wordpress_logged_in_' + md5.digest('hex');
  this.salt = options.loggedInKey + options.loggedInSalt;

  this.db = options.connection;

  this.table_prefix = options.tablePrefix;

  this.known_hashes = {};
  this.known_hashes_timeout = {};
  this.meta_cache = {};
  this.meta_cache_timeout = {};

  // Default cache time: 5 minutes
  this.timeout = 300000;
}

WP_Auth.prototype.checkAuth = function(req) {
  var self = this,
    data = null;
  if (req.headers.cookie)
    req.headers.cookie.split(';').forEach(function(cookie) {
      if (cookie.split('=')[0].trim() == self.cookiename)
        data = cookie
          .split('=')[1]
          .trim()
          .split('%7C');
    });
  else return new Invalid_Auth('no cookie');

  if (!data) return new Invalid_Auth('no data in cookie');

  if (parseInt(data[1]) < new Date() / 1000)
    return new Invalid_Auth('expired cookie');

  return new Valid_Auth(data, this);
};

exports.create = function(options) {
  return new WP_Auth(options);
};

function Invalid_Auth(err) {
  this.err = err;
}
Invalid_Auth.prototype.on = function(key, callback) {
  if (key != 'auth') return this;
  var self = this;
  process.nextTick(function() {
		callback.call(self, {
			isAuthenticated: false,
			userId: 0,
			userName: '',
			userRole: '',
			error: self.err
		});
  });
  return this;
};

function Valid_Auth(data, auth) {
  var self = this,
    user_login = data[0],
    expiration = data[1],
    token = data[2],
    hash = data[3];

  var queryType = { type: auth.db.QueryTypes.SELECT };

  user_login = user_login.replace('%40', '@');

  if (
    user_login in auth.known_hashes_timeout &&
    auth.known_hashes_timeout[user_login] < +new Date()
  ) {
    delete auth.known_hashes[user_login];
    delete auth.known_hashes_timeout[user_login];
  }

  function extractRole(o) {
    var key = Object.keys(o)[0];
    var val = o[key];
    if (!val) {
      throw new Error('Invalid role');
    }
    return key;
  }

  function setRole(id) {
    var roleQuery =
      'select meta_value from ' +
      auth.table_prefix +
      "usermeta where meta_key = '" +
      sanitizeValue('wp_capabilities') +
      "' and user_id = " +
      parseInt(id);

    if (auth.known_hashes[user_login]['role']) {
      self.emit('auth', {
        isAuthenticated: true,
        userId: id,
        userName: auth.known_hashes[user_login].name,
        userRole: auth.known_hashes[user_login].role
      });
    } else {
      auth.db
        .query(roleQuery, queryType)
        .then(data => {
          try {
            auth.known_hashes[user_login].role = extractRole(
              phpjs.unserialize(data[0].meta_value)
            );
            self.emit('auth', {
              isAuthenticated: true,
              userId: id,
              userName: auth.known_hashes[user_login].name,
              userRole: auth.known_hashes[user_login].role
            });
          } catch (data) {
            auth.known_hashes[user_login].role = extractRole(
              data[0].meta_value
            );
            self.emit('auth', {
              isAuthenticated: true,
              userId: id,
              userName: auth.known_hashes[user_login].name,
              userRole: auth.known_hashes[user_login].role
            });
          }
        })
        .catch(e => {
          auth.known_hashes[user_login].role = '';
          self.emit('auth', {
            isAuthenticated: false,
            userId: 0,
            userName: '',
            userRole: '',
            error: 'invalid role'
          });
        });
    }
  }

  function parse(pass_frag, id) {
    var hmac1 = crypto.createHmac('md5', auth.salt);
    var key = user_login + '|' + pass_frag + '|' + expiration + '|' + token;
    hmac1.update(key);
    var hkey = hmac1.digest('hex');
    var hmac2 = crypto.createHmac('sha256', hkey);
    hmac2.update(user_login + '|' + expiration + '|' + token);
    var cookieHash = hmac2.digest('hex');
    if (hash == cookieHash) {
      setRole(id);
    } else {
      self.emit('auth', {
        isAuthenticated: false,
        userId: 0,
        userName: '',
        userRole: '',
        error: 'invalid hash'
      });
    }
  }

  if (user_login in auth.known_hashes) {
    return process.nextTick(function() {
      parse(
        auth.known_hashes[user_login].frag,
        auth.known_hashes[user_login].id
      );
    });
  }

  var userQuery =
    'select ID, user_pass, display_name from ' +
    auth.table_prefix +
    "users where user_login = '" +
    user_login.replace(/(\'|\\)/g, '\\$1') +
    "'";

  auth.db
    .query(userQuery, queryType)
    .then(users => {
      auth.known_hashes[user_login] = {
        frag: users[0].user_pass.substr(8, 4),
        id: users[0].ID,
				name: users[0].display_name
      };
      auth.known_hashes_timeout[user_login] = +new Date() + auth.timeout;
      parse(
        auth.known_hashes[user_login].frag,
        auth.known_hashes[user_login].id
      );
    })
    .catch(e => {
      auth.known_hashes[user_login] = { frag: '__fail__', id: 0 };
      auth.known_hashes_timeout[user_login] = +new Date() + auth.timeout;
      parse(
        auth.known_hashes[user_login].frag,
        auth.known_hashes[user_login].id
      );
    });
}

require('util').inherits(Valid_Auth, require('events').EventEmitter);
