// Deterministic midgame positions for browser and LAN acceptance checks.
const assert = require('node:assert/strict');

function yachtPosition(state, firstSubtotal = 50) {
  state.currentPlayerIndex = 0;
  for (const [i, player] of state.players.entries()) {
    const subtotal = i === 0 ? firstSubtotal : 51;
    Object.assign(player.scorecard, {ones:subtotal-47, twos:6, threes:9, fours:12, fives:20});
  }
  state.completedTurns = 5 * state.players.length;
  state.dice = [6,6,3,2,1];
  state.held = [false,false,false,false,false];
  state.rolls = 1;
}

function dynamitePosition(state, engine, context) {
  const host = state.players[0];
  const duke = state.players.find(p=>p.characterId==='lucky_duke');
  if (duke && duke !== host) {
    duke.characterId = host.characterId;
    duke.maxLife = host.maxLife - Number(host.role==='sheriff') + Number(duke.role==='sheriff');
    duke.life = duke.maxLife;
  }
  host.characterId = 'lucky_duke';
  host.maxLife = 4 + Number(host.role==='sheriff');
  host.life = host.maxLife;

  if (state.pending?.type === 'kitChoice') state.deck.push(...state.pending.cards);
  state.pending = null;
  const zones = [state.deck,state.discard,...state.players.map(p=>p.hand)];
  function take(matches) {
    const zone = zones.find(cards=>cards.some(matches));
    assert.ok(zone,'required card is in the deck or a hand');
    return zone.splice(zone.findIndex(matches),1)[0];
  }
  host.equipment.push(take(card=>card.type==='dynamite'));
  const faces = ['10','9'].map(rank=>take(card=>card.suit==='spades' && card.rank===rank));
  const previous = state.players.at(-1);
  state.discard.push(...previous.hand.splice(previous.life));
  state.deck.push(...faces);
  state.currentIndex = state.players.length-1;
  state.phase = 'play';
  engine.applyAction(state,previous.id,{type:'endTurn'},context);
  assert.equal(state.phase,'judgmentChoice');
  assert.deepEqual(state.pending.cards.map(c=>c.rank),['9','10']);
}

module.exports = {yachtPosition,dynamitePosition};
