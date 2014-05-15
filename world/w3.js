module.exports = (function () {
  var World = Array();

  var levels = [2, 9, 7, 5];
  for (var i=0; i<levels.length; i++){
  	World[i] = require('./w1/s' + levels[i] );
  }
  World[2] = require('./cherry/c1');
  return World;
})();
