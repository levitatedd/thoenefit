// Plate calculator (#227): run with `node tests/plates.test.mjs`.
import { loadBar, plateHint, plateStep, sideText, BARS, PLATES } from '../web/js/plates.js';

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? 'ok   ' : 'FAIL '} ${name}${ok || !detail ? '' : `  (${detail})`}`);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('Pounds');
check('135 on a 45 lb bar is one 45 a side', same(loadBar(135, 45, 'lb').perSide, [45]));
check('205 is 45 + 35 a side, largest first', same(loadBar(205, 45, 'lb').perSide, [45, 35]));
check('215 is 45 + 35 + 5 a side', same(loadBar(215, 45, 'lb').perSide, [45, 35, 5]));
check('225 uses two 45s a side, not smaller plates', same(loadBar(225, 45, 'lb').perSide, [45, 45]));
check('115 uses a 35 rather than 25 + 10', same(loadBar(115, 45, 'lb').perSide, [35]));
check('the small plates: 50 is 2.5 a side', same(loadBar(50, 45, 'lb').perSide, [2.5]));
check('just the bar loads nothing', same(loadBar(45, 45, 'lb'), { perSide: [], loaded: 45, exact: true, up: 45 }));
check('a 35 lb bar changes the plates: 135 is 45 + 5 a side', same(loadBar(135, 35, 'lb').perSide, [45, 5]));
check('with no bar the plates make up the whole weight: 90 is one 45 a side', same(loadBar(90, 0, 'lb').perSide, [45]));
{
  const r = loadBar(137, 45, 'lb');
  check('a weight that cannot be loaded gives the closest below and the next above', !r.exact && r.loaded === 135 && r.up === 140, JSON.stringify(r));
}
check('lighter than the bar, zero or missing gives nothing', [loadBar(40, 45, 'lb'), loadBar(0, 45, 'lb'), loadBar(null, 45, 'lb'), loadBar(NaN, 45, 'lb')].every((v) => v === null));

console.log('Kilograms');
check('100 kg on a 20 kg bar is 25 + 15 a side', same(loadBar(100, 20, 'kg').perSide, [25, 15]));
check('62.5 kg uses the 1.25s: 20 + 1.25 a side', same(loadBar(62.5, 20, 'kg').perSide, [20, 1.25]));
check('a 15 kg bar: 60 is 20 + 2.5 a side', same(loadBar(60, 15, 'kg').perSide, [20, 2.5]));

console.log('Wording');
check('the hint lists the plates for one side', plateHint(185, 45, 'lb') === 'Plates: 45 + 25 a side', plateHint(185, 45, 'lb'));
check('the bar alone says so', plateHint(45, 45, 'lb') === 'Just the bar');
check('a weight off the plates offers the closest one', plateHint(187, 45, 'lb') === 'Closest: 185 (45 + 25 a side)', plateHint(187, 45, 'lb'));
check('below the next plate with nothing loadable, it is just the bar', plateHint(47, 45, 'lb') === 'Closest: 45 (just the bar)', plateHint(47, 45, 'lb'));
check('no hint without a usable weight', plateHint(null, 45, 'lb') === '' && plateHint(20, 45, 'lb') === '');
check('decimals read cleanly', sideText([25, 1.25]) === '25 + 1.25');
check('the smallest step is two of the smallest plate', plateStep('lb') === 5 && plateStep('kg') === 2.5);
check('the default bars are 45 lb and 20 kg', BARS.lb[0] === 45 && BARS.kg[0] === 20 && PLATES.lb[0] === 45);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
