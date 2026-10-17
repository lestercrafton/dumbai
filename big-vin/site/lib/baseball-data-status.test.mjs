import test from 'node:test';
import assert from 'node:assert/strict';
import {baseballDataStatus} from './baseball-data-status.mjs';
const input={schemaVersion:1,collectedAt:'2026-09-17T12:00:00Z',completedThrough:'2026-09-16',games:7234,teamGames:14468,pitcherGames:0,statcastPitches:4501,probablePitchers:0,rosterPlayers:0,playerSeasonStats:0,sourceResponses:20,sourceDisagreements:259,seasons:[2024,2025,2026],warnings:[]};
test('public collection status only retains aggregate fields',()=>{const result=baseballDataStatus({...input,token:'must-not-leak',rawData:{private:'omitted'}});assert.equal(result.token,undefined);assert.equal(result.rawData,undefined);assert.equal(result.games,7234);});
test('rejects fabricated freshness and invalid counts',()=>{assert.throws(()=>baseballDataStatus({...input,collectedAt:'2100-01-01'}),/dated/);assert.throws(()=>baseballDataStatus({...input,games:-1}),/counts/);assert.throws(()=>baseballDataStatus({...input,completedThrough:'nonsense'}),/dated/);});
