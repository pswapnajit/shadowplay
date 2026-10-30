/**
 * The story's stage effects. A cue (night, moon, rain, thunder, dawn…) sets
 * targets; every frame the levels ease towards them and drive the wall
 * shader, the lantern's sway in the wind, and the weather sounds.
 */

import type { ShaderMaterial, Vector2, Vector4 } from '@iwsdk/core';
import type { Cue } from '../story/protocol.js';
import { audio } from './audio.js';

type Level = 'night' | 'dawn' | 'stars' | 'moon' | 'rain' | 'snow' | 'fireflies' | 'wind';
const LEVELS: Level[] = ['night', 'dawn', 'stars', 'moon', 'rain', 'snow', 'fireflies', 'wind'];
const zero = (): Record<Level, number> => ({ night: 0, dawn: 0, stars: 0, moon: 0, rain: 0, snow: 0, fireflies: 0, wind: 0 });

/** Seconds for each level to ease most of the way to its target. */
const EASE: Record<Level, number> = { night: 3, dawn: 4, stars: 3, moon: 2.5, rain: 2, snow: 3, fireflies: 2.5, wind: 2 };

export class StageFx {
  readonly level = zero();
  private readonly target = zero();
  private flash = 0;
  private flashes: number[] = [];
  private thunderAt = -1;
  private moonRise = 1;
  private chimeT = 0;
  private time = 0;
  /** Shadow offset on the wall from the swaying lantern (metres, wall axes). */
  readonly sway: [number, number] = [0, 0];
  /** 0..1: damps the sway while the player is matching a shape. */
  steady = 0;
  /** The last cues, newest last (debug overlay). */
  readonly history: Cue[] = [];

  cue(c: Cue): void {
    const t = this.target;
    this.history.push(c);
    if (this.history.length > 12) this.history.shift();
    switch (c) {
      case 'night':
        t.night = 1;
        t.dawn = 0;
        audio.bed('crickets', 1);
        break;
      case 'moon':
        t.moon = 1;
        t.night = Math.max(t.night, 0.7);
        t.dawn = 0;
        if (this.level.moon < 0.3) this.moonRise = 0;
        audio.swell('moon');
        break;
      case 'stars':
        t.stars = 1;
        t.night = Math.max(t.night, 0.6);
        t.dawn = 0;
        audio.sparkle(6);
        break;
      case 'wind':
        t.wind = 1;
        audio.bed('wind', 1);
        break;
      case 'rain':
        t.rain = 1;
        t.snow = 0;
        t.fireflies = 0;
        audio.bed('rain', 1);
        break;
      case 'snow':
        t.snow = 1;
        t.rain = 0;
        t.fireflies = 0;
        audio.bed('rain', 0);
        audio.bed('wind', 0.35);
        break;
      case 'thunder':
        // light first, sound after: a double flicker, then the roll
        this.flashes.push(this.time, this.time + 0.16, this.time + 0.42);
        this.thunderAt = this.time + 0.7;
        if (t.rain < 0.5 && t.snow < 0.5) {
          t.rain = 0.7;
          audio.bed('rain', 0.7);
        }
        break;
      case 'fireflies':
        t.fireflies = 1;
        t.rain = 0;
        t.snow = 0;
        audio.bed('rain', 0);
        break;
      case 'dawn':
        t.dawn = 1;
        t.night = 0;
        t.moon = 0;
        t.stars = 0;
        t.fireflies = 0;
        t.rain = 0;
        t.snow = 0;
        audio.bed('crickets', 0);
        audio.bed('rain', 0);
        audio.swell('dawn');
        audio.birdsong();
        break;
      case 'calm':
        t.rain = 0;
        t.snow = 0;
        t.wind = 0;
        audio.bed('rain', 0);
        audio.bed('wind', 0);
        break;
    }
  }

  /** Back to the plain lantern-lit wall. */
  reset(): void {
    for (const k of LEVELS) this.target[k] = 0;
    this.flashes.length = 0;
    this.thunderAt = -1;
    this.history.length = 0;
    audio.bed('rain', 0);
    audio.bed('wind', 0);
    audio.bed('crickets', 0);
  }

  get active(): boolean {
    return LEVELS.some((k) => this.level[k] > 0.002 || this.target[k] > 0);
  }

  update(dt: number, wall: ShaderMaterial): void {
    this.time += dt;
    for (const k of LEVELS) this.level[k] += (this.target[k] - this.level[k]) * Math.min(1, (dt * 3) / EASE[k]);

    // Lightning: each flash decays fast; the thunder follows.
    while (this.flashes.length && this.flashes[0] <= this.time) {
      this.flash = Math.max(this.flash, this.flashes.length === 1 ? 0.6 : 1);
      this.flashes.shift();
    }
    this.flash = Math.max(0, this.flash - dt * 4.5);
    if (this.thunderAt >= 0 && this.time >= this.thunderAt) {
      this.thunderAt = -1;
      audio.thunder();
    }

    // Fireflies chime now and then.
    if (this.level.fireflies > 0.5) {
      this.chimeT -= dt;
      if (this.chimeT < 0) {
        this.chimeT = 1.4 + Math.random() * 2;
        audio.sparkle(1);
      }
    }

    // The moon rises from just above the light into the dark sky.
    this.moonRise = Math.min(1, this.moonRise + dt / 7);
    const rise = 1 - Math.pow(1 - this.moonRise, 3);

    // Wind swings the lantern; the shadows swing with it.
    const w = this.level.wind * (1 - 0.75 * this.steady);
    const A = 0.045 * w;
    const t = this.time;
    this.sway[0] = A * (Math.sin(t * 1.35) + 0.45 * Math.sin(t * 3.1 + 1.3));
    this.sway[1] = A * 0.3 * Math.sin(t * 2.2 + 0.4);

    const u = wall.uniforms;
    (u.uSky.value as Vector4).set(this.level.night, this.level.dawn, this.level.stars, this.level.moon);
    (u.uWeather.value as Vector4).set(this.level.rain, this.level.snow, this.level.fireflies, this.flash);
    (u.uMoon.value as Vector2).set(-0.98, 0.58 + 0.34 * rise);
    (u.uSway.value as Vector2).set(this.sway[0], this.sway[1]);
  }
}
