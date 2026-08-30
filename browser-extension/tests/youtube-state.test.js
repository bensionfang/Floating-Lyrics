const test = require('node:test');
const assert = require('node:assert/strict');

const {
  projectYouTubeState,
  createStateReporter,
  classifyYouTubeBlock,
} = require('../src/youtube-content.js');

test('projectYouTubeState marks ads and emits the canonical state shape', () => {
  assert.deepEqual(projectYouTubeState({
    revision: 2,
    videoId: 'dQw4w9WgXcQ',
    title: 'Never Gonna Give You Up',
    channelTitle: 'RickAstleyVEVO',
    currentTime: 12.345,
    duration: 213.4,
    playerState: 1,
    isAd: true,
  }), {
    type: 'youtube_karaoke_state',
    state: {
      revision: 2,
      videoId: 'dQw4w9WgXcQ',
      title: 'Never Gonna Give You Up',
      channel: 'RickAstleyVEVO',
      state: 'ad',
      positionMs: 12345,
      durationMs: 213400,
      keySemitones: 0,
      error: null,
    },
  });
});

test('projectYouTubeState maps player states and typed errors', () => {
  assert.equal(projectYouTubeState({
    revision: 1,
    videoId: 'dQw4w9WgXcQ',
    currentTime: 1,
    duration: 2,
    playerState: 1,
  }).state.state, 'playing');
  assert.equal(projectYouTubeState({
    revision: 1,
    videoId: 'dQw4w9WgXcQ',
    currentTime: 1,
    duration: 2,
    playerState: 2,
  }).state.state, 'paused');
  assert.deepEqual(projectYouTubeState({
    revision: 4,
    videoId: 'dQw4w9WgXcQ',
    currentTime: 0,
    duration: 0,
    blockedCode: 'youtube-video-unavailable',
  }).state.error, {
    code: 'youtube-video-unavailable',
    message: 'youtube-video-unavailable',
  });
  assert.equal(projectYouTubeState({
    revision: 5,
    videoId: 'dQw4w9WgXcQ',
    currentTime: 1,
    duration: 2,
    playerState: 3,
  }).state.state, 'buffering');
  assert.equal(projectYouTubeState({
    revision: 6,
    videoId: 'dQw4w9WgXcQ',
    currentTime: 0,
    duration: 2,
    isLoading: true,
  }).state.state, 'loading');
  assert.deepEqual(projectYouTubeState({
    revision: 7,
    videoId: 'dQw4w9WgXcQ',
    currentTime: 0,
    duration: 0,
    blockedCode: 'youtube-age-restricted',
    blockedMessage: 'Sign in to confirm your age',
  }).state.error, {
    code: 'youtube-age-restricted',
    message: 'Sign in to confirm your age',
  });
});

test('createStateReporter emits ended once per revision and suppresses tiny drift spam', () => {
  const sent = [];
  const reporter = createStateReporter((msg) => sent.push(msg));

  reporter.report(projectYouTubeState({
    revision: 7,
    videoId: 'dQw4w9WgXcQ',
    currentTime: 10,
    duration: 120,
    playerState: 1,
  }));
  reporter.report(projectYouTubeState({
    revision: 7,
    videoId: 'dQw4w9WgXcQ',
    currentTime: 10.05,
    duration: 120,
    playerState: 1,
  }));
  reporter.report(projectYouTubeState({
    revision: 7,
    videoId: 'dQw4w9WgXcQ',
    currentTime: 120,
    duration: 120,
    playerState: 0,
  }));
  reporter.report(projectYouTubeState({
    revision: 7,
    videoId: 'dQw4w9WgXcQ',
    currentTime: 120,
    duration: 120,
    playerState: 0,
  }));
  reporter.report(projectYouTubeState({
    revision: 8,
    videoId: 'kJQP7kiw5Fk',
    currentTime: 1,
    duration: 200,
    playerState: 0,
  }));

  assert.equal(sent.length, 3);
  assert.equal(sent[0].state.state, 'playing');
  assert.equal(sent[1].state.state, 'ended');
  assert.equal(sent[2].state.revision, 8);
});

test('classifyYouTubeBlock keeps sign-in and age errors distinct', () => {
  assert.deepEqual(classifyYouTubeBlock('Sign in to confirm your age', false), {
    code: 'youtube-sign-in-required',
    message: 'Sign in to confirm your age',
  });
  assert.deepEqual(classifyYouTubeBlock('This video is age-restricted', false), {
    code: 'youtube-age-restricted',
    message: 'YouTube age restriction',
  });
});
