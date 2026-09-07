(() => {
  const state = window.hearuPerformanceTest = {
    tracks: [], pendingPatches: 0, peakPatches: 0, patchIntents: [], nextTrack: 0,
    room: { code: 'TEST', name: 'Performance room', currentTrackId: '', trackName: '', trackType: 'audio/wav', trackSize: 0, duration: 60, isPlaying: false, position: 0, version: 0, hostOnly: true, reactionsEnabled: true, expiresAt: Date.now() + 3600000, serverTime: Date.now() }
  };
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const json = (value) => new Response(JSON.stringify(value), {status:200, headers:{'Content-Type':'application/json'}});
  window.hearuUpload = async (url, headers, body, progress, signal, method) => {
    if (method === 'POST') {
      const index = Number(body.get('position'));
      progress(body.get('audio').size / 2);
      await delay(index ? 12000 : 100);
      signal.throwIfAborted();
      const track = {id:`test-${index + 1}`, name:body.get('trackName'), type:'audio/wav', size:body.get('audio').size, duration:60, position:index};
      state.tracks.push(track);
      if (!index) Object.assign(state.room, {currentTrackId:track.id, trackName:track.name});
      return json({track});
    }
    progress(body.size / 2);
    await delay(url.includes('trackId=test-2') ? 12000 : 100);
    signal.throwIfAborted();
    progress(body.size);
    return json({partNumber:Number(new URL(url, location.href).searchParams.get('partNumber')), etag:'test-etag'});
  };
  window.fetch = async (input, init = {}) => {
    const path = new URL(String(input), location.href).pathname;
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : {};
    if (path === '/api/rooms') return json({room:{code:'TEST'}, hostToken:'test-host', memberId:'test-member', displayName:'Listener'});
    if (path.endsWith('/tracks/upload')) {
      if (body.action === 'start') return json({trackId:`test-${++state.nextTrack}`, uploadId:'test-upload-id'});
      if (body.action === 'complete') {
        state.tracks.push({id:body.trackId, name:body.name, type:body.type, size:body.size, duration:60, position:body.position});
        if (state.tracks.length === 1) Object.assign(state.room, {currentTrackId:body.trackId, trackName:body.name});
        return json({ok:true});
      }
      return json({ok:true});
    }
    if (path === '/api/rooms/TEST' && init.method === 'PATCH') {
      state.peakPatches = Math.max(state.peakPatches, ++state.pendingPatches);
      state.patchIntents.push(body.isPlaying);
      await delay(2400);
      Object.assign(state.room, {isPlaying:body.isPlaying, position:body.position, currentTrackId:body.trackId, version:state.room.version+1});
      state.pendingPatches--;
      return json({room:state.room});
    }
    if (path === '/api/rooms/TEST') {
      const snapshot = structuredClone({room:state.room, tracks:state.tracks, members:[{id:'test-member',displayName:'Listener',isHost:true}], reactions:[]});
      await delay(500);
      return json(snapshot);
    }
    return json({ok:true});
  };
  return true;
})()
