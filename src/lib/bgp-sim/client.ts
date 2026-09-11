'use client';

import { useEffect, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { SimState, SimConfig, CustomAttackSpec } from './types';

/**
 * BGP simulation socket client.
 * IMPORTANT: connection must go through the gateway with XTransformPort query
 * and path '/' — never a direct localhost URL.
 */
export function createBgpSocket(): Socket {
  return io('/?XTransformPort=3010', {
    path: '/',
    transports: ['websocket', 'polling'],
    reconnectionDelay: 800,
    reconnectionDelayMax: 4000,
  });
}

let sharedSocket: Socket | null = null;
const listeners = new Set<(s: SimState) => void>();

function getSharedSocket(): Socket {
  if (!sharedSocket) {
    sharedSocket = createBgpSocket();
    sharedSocket.on('sim:state', (state: SimState) => {
      for (const cb of listeners) {
        try {
          cb(state);
        } catch {
          /* ignore listener errors */
        }
      }
    });
  }
  return sharedSocket;
}

export function useBgpSim() {
  const [state, setState] = useState<SimState | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const socket = getSharedSocket();
    const listener = (s: SimState) => setState(s);
    listeners.add(listener);
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    const initial = socket.connected;
    const raf = requestAnimationFrame(() => {
      setConnected(initial);
      if (initial) {
        // request a fresh snapshot
        socket.emit('sim:tick');
      }
    });
    return () => {
      cancelAnimationFrame(raf);
      listeners.delete(listener);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, []);

  const start = useCallback(() => getSharedSocket().emit('sim:start'), []);
  const pause = useCallback(() => getSharedSocket().emit('sim:pause'), []);
  const reset = useCallback(() => getSharedSocket().emit('sim:reset'), []);
  const tickOnce = useCallback(() => getSharedSocket().emit('sim:tick'), []);
  const updateConfig = useCallback((patch: Partial<SimConfig> | Record<string, unknown>) => {
    getSharedSocket().emit('config:update', patch);
  }, []);
  const applyPreset = useCallback((variant: string) => {
    getSharedSocket().emit('config:preset', variant);
  }, []);
  const resetConfig = useCallback(() => {
    getSharedSocket().emit('config:reset');
  }, []);
  const injectAttack = useCallback((scenarioId: string, durationSec?: number) => {
    getSharedSocket().emit('attack:inject', { scenarioId, durationSec });
  }, []);
  const injectCustom = useCallback((spec: CustomAttackSpec) => {
    getSharedSocket().emit('attack:custom', spec);
  }, []);
  const withdrawAttack = useCallback(() => {
    getSharedSocket().emit('attack:withdraw');
  }, []);

  return {
    state,
    connected,
    start,
    pause,
    reset,
    tickOnce,
    updateConfig,
    applyPreset,
    resetConfig,
    injectAttack,
    injectCustom,
    withdrawAttack,
  };
}
