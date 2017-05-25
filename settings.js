// --------------------------------- 80chars ---------------------------------->
var connections = { 
  codecombat: {
    name: 'CodeCombat',
    url: 'https://codecombat.com',
    href: 'https://codecombat.com/db/user/{{username}}',
    parser: function (data, params={}) { 
      if (typeof params['field'] == 'undefined') 
        params['field'] = 'points'; return JSON.parse(data)[params.field] 
    },
  },
  projecteuler: {
    name: 'Project Euler',
    url: 'https://projecteuler.net',
    href: 'https://projecteuler.net/profile/{{username}}.txt',
    parser: function (data) { return (""+data).split(',')[3] },
  },
  clozemaster: {
    name: 'Clozemaster',
    url: 'https://www.clozemaster.com',
    href: 'https://www.clozemaster.com/api/v1/players/{{username}}',
    parser: function (data, params={}) { 
      if (typeof params['field'] == 'undefined') 
        params['field'] = 'score'; return JSON.parse(data)[params.field] 
    },
  }
}

module.exports.connections = connections
