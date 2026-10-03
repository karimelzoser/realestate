import fs from 'node:fs';

const read=p=>fs.readFileSync(p,'utf8');
const index=read('index.html');
const js=read('src/features/presentation/index.js');
const css=read('src/features/presentation/index.css');
const voice=read('src/features/presentation/voice-polish.js');
const english=read('src/features/local-voice-agent/english-only.js');
const fail=[];
function must(text,needle,label){if(!text.includes(needle))fail.push(label||('Missing '+needle));}
function mustNot(text,needle,label){if(text.includes(needle))fail.push(label||('Unexpected '+needle));}

must(index,"appendStyle('src/features/presentation/index.css')",'Presentation CSS not loaded');
must(index,"appendScript('src/features/presentation/index.js')",'Presentation JS not loaded');
must(index,"appendScript('src/features/presentation/voice-polish.js')",'Voice presentation polish not loaded');
for(const name of ['normal','queue','conflict','overdue','brokers'])must(js,"['"+name+"'",'Missing presentation scenario '+name);
must(js,"window.p66ResetDemo",'Reset Demo API missing');
must(js,"MANAGEMENT DECISION ROOM",'Manager decision room missing');
must(js,"Recorded Event",'Presentation audit wording missing');
must(js,"Current State Snapshot",'Current-state audit wording missing');
must(js,"Overdue Collections",'Collections presentation scenario missing');
must(js,"Unit Lock Conflict",'Lock conflict scenario missing');
must(css,'.p66-console','Presentation console styles missing');
must(css,'.p66-decision','Decision room styles missing');

must(english,'BROWSER VOICE • READY','Active English browser voice fallback label missing');
must(voice,'English live allocation advisor','Metro presentation English advisor copy missing');
must(voice,'English live','Metro presentation English advisor tag missing');
mustNot(voice,'جاهز للعرض','Presentation polish still contains the retired Arabic fallback label');
mustNot(voice,'Local Egyptian AI','Presentation polish still describes the retired active Egyptian runtime');

if(fail.length){console.error('PRENEURA presentation validation failed');fail.forEach(x=>console.error('- '+x));process.exit(1)}
console.log('PRENEURA presentation release validated');
console.log('- deterministic reset');
console.log('- five prepared operating scenarios');
console.log('- manager decision room');
console.log('- presentation-friendly audit terminology');
console.log('- visible advisor labels match the active English-only 6.7 release');
