// initialize the server
var port = process.env.PORT || 21474,
    server = require('http').createServer();
server.listen(port);
var io = require('socket.io').listen(server, { log: true });
io.configure('origins', 'http://localhost:*', 'http://cherrry.github.io:*', 'https://cherrry.github.io:*');

// read world data
var WorldData = require('./world');
console.log(WorldData);

// useful functions
var random_string = (function() {
  var char_list = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXTZabcdefghiklmnopqrstuvwxyz";
  return function(length) {
    var ret = '';
    for (var i = 0; i < length; i++) {
      ret += char_list.charAt(Math.floor(Math.random() * 60));
    }
    return ret;
  };
})();
var next_color = function(room, old_color) {
  //console.log(room.players);
  var color = Array(8);
  for (var i = 0; i < 8; i++) {
    color[i] = 0;
  }
  for (var i = 0; i < 4; i++) {
    if (room.players[i] != null) {
      color[room.players[i].color] = 1;
    }
  }
  for (var i = old_color + 1; i < 8; i++) {
    if (color[i] == 0) return i;
  }
  for (var i = 0; i < old_color; i++) {
    if (color[i] == 0) return i;
  }
  return -1;
};

// player data
var players = Object(),
    rooms = Array(6);

for (var i = 0; i < 6; i++) {
  rooms[i] = { number: i, players: [ null, null, null, null ], state: 'wait', settings: { world: 1, life: 3 } };
}


// accepting new connection
io.sockets.on('connection', function (socket) {
  var player = {
    id: random_string(8),
    name: 'Player',
    room: { number: -1, position: -1 }
  };
  players[player.id] = player;

  socket.join('idle');

  // player connect to server
  socket.on('connect request', function (data) {
    //console.log('new connection: ' + data.name);
    player.name = data.name;
    socket.emit('connect response', { player: { id: player.id }, rooms: rooms });
  });

  // measure network latency
  socket.on('ping', function () {
    socket.emit('pong');
  });

  // player change his/her name
  socket.on('name change', function (data) {
    player.name = data.name;

    if (player.room.number != -1) {
      // boardcast name change to idle player and player in same room
      rooms[player.room.number].players[player.room.position].name = player.name;
      io.sockets.in('room_' + player.room.number).emit('room status change', rooms[player.room.number]);
      socket.broadcast.in('idle').emit('room status change', rooms);
    }
  });

  // join a game room
  socket.on('join room request', function (data) {

    var room = rooms[data.room], accept = false, isOwner = true;

    if (player.room.number != -1) {
      return;
    }

    if (room.state == 'play') {
      socket.emit('join room response', { status: 'reject' });
      return;
    }

    for (var i = 0; i < 4; i++) {
      if (room.players[i] != null && room.players[i].isOwner) {
        isOwner = false;
      }
    }

    for (var i = 0; i < 4; i++) {
      if (room.players[i] == null) {
        // there is empty space
        accept = true;

        // assign player to room
        room.players[i] = { id: player.id, name: player.name, color: next_color(room, -1), ready: false, isOwner: isOwner };
        player.room = { number: data.room, position: i };
        break;
      }
    }

    if (accept) {
      // accepting player request

      // check if room become full
      room.state = 'full';
      for (var i = 0; i < 4; i++) {
        if (room.players[i] == null) {
          room.state = 'wait';
        }
      }

      socket.leave('idle');
      socket.join('room_' + player.room.number);
      socket.emit('join room response', { status: 'accept', room: room });

      socket.broadcast.in('room_' + player.room.number).emit('room status change', room);
      socket.broadcast.in('idle').emit('room status change', rooms);
    } else {
      // reject as the game room is full
      socket.emit('join room response', { status: 'reject' });
    }

    //console.log(room);
  });

  // leave room
  socket.on('leave room request', function (data) {
    if (player.room.number == -1) {
      return;
    }

    var room = rooms[player.room.number];

    room.state = 'wait';

    // choose next owner
    if (room.players[player.room.position].isOwner) {
      var candidate = Array(), candidate_count = 0, nextOwner;
      for (var i = 0; i < 4; i++) {
        if (room.players[i] != null && i != player.room.position) {
          candidate[candidate_count++] = room.players[i];
        }
      }
      if (candidate_count > 0) {
        nextOwner = candidate[Math.floor(Math.random() * candidate_count)];
        nextOwner.isOwner = true;
      }
    }
    room.players[player.room.position] = null;

    //console.log('after someone leave: ' + JSON.stringify(room));

    socket.broadcast.in('room_' + player.room.number).emit('room status change', rooms[player.room.number]);
    socket.broadcast.in('idle').emit('room status change', rooms);

    socket.leave('room_' + player.room.number);
    socket.join('idle');

    player.room = { number: -1, position: -1 };
    socket.emit('leave room response', { status: 'accept', rooms: rooms });
  });

  // chatting
  socket.on('chat message send', function (data) {
    if (player.room.number == -1) {
      // ignore player message when he/she is not in a room
      return;
    }
    var room = rooms[player.room.number];

    io.sockets.in('room_' + player.room.number).emit('chat message recieved', { name: player.name, color: room.players[player.room.position].color, message: data.message });
    //console.log('chat message is broadcasted: ' + JSON.stringify(data));
  });

  // change color
  socket.on('change color request', function (data) {
    if (player.room.number == -1) {
      // ignore request from invalid user
      return;
    }
    var room = rooms[player.room.number];
    var color = room.players[player.room.position].color;
    room.players[player.room.position].color = next_color(room, color);
    io.sockets.in('room_' + player.room.number).emit('room status change', room);
    socket.broadcast.in('idle').emit('room status change', rooms);
  });

  // change setting
  socket.on('change settings', function (data) {
    if (player.room.number == -1) {
      return;
    }

    var room = rooms[player.room.number];
    if (data.world) {
      room.settings.world = data.world;
    }
    if (data.life) {
      room.settings.life = data.life;
    }
    
    socket.broadcast.in('room_' + player.room.number).emit('room settings changed', room.settings);
  });

  // ready state change
  socket.on('ready state change', function (data) {
    if (player.room.number == -1) {
      return;
    }

    var room = rooms[player.room.number];
    room.players[player.room.position].ready = data.ready;
    io.sockets.in('room_' + player.room.number).emit('room status change', room);
  });

  // action of disconnecting
  socket.on('disconnect', function () {
    // remove player in any room
    if (player.room.number != -1) {
      var room = rooms[player.room.number];

      if (room.state != 'play') {
        room.state = 'wait';
      }

      // choose next owner
      if (room.players[player.room.position].isOwner) {
        var candidate = Array(), candidate_count = 0, nextOwner;
        for (var i = 0; i < 4; i++) {
          if (room.players[i] != null && i != player.room.position) {
            candidate[candidate_count++] = room.players[i];
          }
        }
        if (candidate_count > 0) {
          nextOwner = candidate[Math.floor(Math.random() * candidate_count)];
          nextOwner.isOwner = true;
        } else {
          room.state = 'wait';
        }
      }
      room.players[player.room.position] = null;

      // broadcast about room status change
      socket.broadcast.in('room_' + player.room.number).emit('room status change', rooms[player.room.number]);
      socket.broadcast.in('idle').emit('room status change', rooms);
    }
    // remove player from memory
    delete players[player.id];

    for (var room in io.sockets.manager.roomClients[socket.id]) {
      socket.leave(room);
    }
  });

  // start game
  socket.on('start game request', function (data) {
    if (player.room.number == -1) {
      return;
    }
    var room = rooms[player.room.number];
    var readyCount = 0, totalPlayer = 0;
    if (!room.players[player.room.position].isOwner) {
      return;
    }

    for (var i = 0; i < 4; i++) {
      if (rooms[player.room.number].players[i]){
        totalPlayer++;
        if(rooms[player.room.number].players[i].ready)
          readyCount++;
      }
    }

    if (readyCount == totalPlayer && totalPlayer > 0) {
      room.state = 'play';
      io.sockets.in('room_' + player.room.number).emit('start game response', { status: 'accept' });
      socket.broadcast.in('idle').emit('room status change', rooms);

      io.sockets.in('room_' + player.room.number).emit('game init', { world: WorldData.W1[0], players: room.players });
    } else {
      socket.emit('start game response', { status: 'reject' });
    }
  });

  socket.on('player data update', function (data) {
    if (player.room.number == -1) {
      return;
    }
    var room = rooms[player.room.number];
    if (room.state != 'play') {
      return;
    }

    socket.broadcast.in('room_' + player.room.number).emit('player data update', data);
  });

});
