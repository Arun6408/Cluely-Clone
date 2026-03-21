use std::sync::{
  atomic::{AtomicBool, Ordering},
  Arc,
};
use std::time::{Duration, Instant};

use base64::prelude::*;
use serde::Serialize;
use tauri::{Emitter, EventTarget};

use windows::Win32::{
  Media::Audio::{
    eConsole, eRender, IAudioCaptureClient, IAudioClient, IMMDeviceEnumerator,
    MMDeviceEnumerator, AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK,
    AUDCLNT_BUFFERFLAGS_SILENT,
  },
  System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED},
};

#[derive(Clone, Debug, Serialize)]
pub struct SystemAudioDebug {
  pub sample_rate: u32,
  pub frames: u64,
  pub packets: u64,
}

#[derive(Clone, Debug, Serialize)]
pub struct SystemAudioData {
  pub sample_rate: u32,
  pub data_b64: String,
}

pub fn start_system_audio_loopback_thread(
  app_handle: tauri::AppHandle,
  stop: Arc<AtomicBool>,
) {
  std::thread::spawn(move || {
    unsafe {
      let hr = CoInitializeEx(None, COINIT_MULTITHREADED);
      if hr.0 < 0 {
        eprintln!("[SystemAudio] COM init failed: {:?}", hr);
        return;
      }
    }

    unsafe {
      let enumerator: IMMDeviceEnumerator = match CoCreateInstance(
        &MMDeviceEnumerator,
        None,
        CLSCTX_ALL,
      ) {
        Ok(v) => v,
        Err(e) => {
          eprintln!("[SystemAudio] CoCreateInstance IMMDeviceEnumerator failed: {:?}", e);
          return;
        }
      };

      let device = match enumerator.GetDefaultAudioEndpoint(eRender, eConsole) {
        Ok(d) => d,
        Err(e) => {
          eprintln!("[SystemAudio] GetDefaultAudioEndpoint failed: {:?}", e);
          return;
        }
      };

      let audio_client: IAudioClient = match device.Activate(CLSCTX_ALL, None) {
        Ok(c) => c,
        Err(e) => {
          eprintln!("[SystemAudio] Activate IAudioClient failed: {:?}", e);
          return;
        }
      };

      let mix_format = match audio_client.GetMixFormat() {
        Ok(f) => f,
        Err(e) => {
          eprintln!("[SystemAudio] GetMixFormat failed: {:?}", e);
          return;
        }
      };
      let sample_rate = (*mix_format).nSamplesPerSec;
      let channels = (*mix_format).nChannels as usize;
      let bits_per_sample = (*mix_format).wBitsPerSample as usize;

      if let Err(e) = audio_client.Initialize(
        AUDCLNT_SHAREMODE_SHARED,
        AUDCLNT_STREAMFLAGS_LOOPBACK,
        0,
        0,
        mix_format,
        None,
      ) {
        eprintln!("[SystemAudio] Initialize loopback failed: {:?}", e);
        return;
      }

      let capture_client: IAudioCaptureClient = match audio_client.GetService() {
        Ok(s) => s,
        Err(e) => {
          eprintln!("[SystemAudio] GetService IAudioCaptureClient failed: {:?}", e);
          return;
        }
      };

      if let Err(e) = audio_client.Start() {
        eprintln!("[SystemAudio] Start failed: {:?}", e);
        return;
      }

      eprintln!("[SystemAudio] loopback capture started");

      let mut frames_in_period: u64 = 0;
      let mut packets_in_period: u64 = 0;
      let mut last_emit = Instant::now();

      loop {
        if stop.load(Ordering::Relaxed) {
          let _ = audio_client.Stop();
          eprintln!("[SystemAudio] stopped");
          break;
        }

        let packet_size = capture_client.GetNextPacketSize().unwrap_or(0);
        if packet_size == 0 {
          std::thread::sleep(Duration::from_millis(10));
          continue;
        }

        let mut packet_size_mut = packet_size;
        while packet_size_mut > 0 && !stop.load(Ordering::Relaxed) {
          let mut data_ptr: *mut u8 = std::ptr::null_mut();
          let mut frames: u32 = 0;
          let mut flags: u32 = 0;

          let _ = capture_client.GetBuffer(
            &mut data_ptr,
            &mut frames,
            &mut flags,
            None,
            None,
          );

          if frames > 0 {
            if !data_ptr.is_null() && (flags & (AUDCLNT_BUFFERFLAGS_SILENT.0 as u32)) == 0 {
              let total_samples = frames as usize * channels;
              
              let mut pcm16: Option<Vec<i16>> = None;

              if bits_per_sample == 32 {
                  let audio_f32: &[f32] = std::slice::from_raw_parts(data_ptr as *const f32, total_samples);
                  let mut mono: Vec<f32> = Vec::with_capacity(frames as usize);
                  for frame in audio_f32.chunks(channels) {
                      let sum: f32 = frame.iter().copied().sum();
                      mono.push(sum / channels as f32);
                  }
                  pcm16 = Some(mono.iter().map(|&x| (x.clamp(-1.0, 1.0) * i16::MAX as f32) as i16).collect());
              } else if bits_per_sample == 16 {
                  let audio_i16: &[i16] = std::slice::from_raw_parts(data_ptr as *const i16, total_samples);
                  let mut mono: Vec<i16> = Vec::with_capacity(frames as usize);
                  for frame in audio_i16.chunks(channels) {
                      let sum: i32 = frame.iter().map(|&v| v as i32).sum();
                      mono.push((sum / channels as i32) as i16);
                  }
                  pcm16 = Some(mono);
              }

              if let Some(pcm) = pcm16 {
                let pcm_bytes = std::slice::from_raw_parts(
                    pcm.as_ptr() as *const u8,
                    pcm.len() * std::mem::size_of::<i16>(),
                );
                let b64 = BASE64_STANDARD.encode(pcm_bytes);
                let audio_data = SystemAudioData {
                    sample_rate,
                    data_b64: b64,
                };
                let _ = app_handle.emit_to(
                    EventTarget::webview_window("main"),
                    "system-audio-data",
                    audio_data,
                );
              }
            }
            frames_in_period += frames as u64;
            packets_in_period += 1;
          }

          let _ = capture_client.ReleaseBuffer(frames);
          packet_size_mut = capture_client.GetNextPacketSize().unwrap_or(0);
        }

        if last_emit.elapsed() >= Duration::from_secs(1) {
          let debug = SystemAudioDebug {
            sample_rate,
            frames: frames_in_period,
            packets: packets_in_period,
          };

          let _ = app_handle.emit_to(
            EventTarget::webview_window("main"),
            "system-audio-debug",
            debug,
          );

          eprintln!(
            "[SystemAudio] frames/sec={} packets/sec={}",
            frames_in_period, packets_in_period
          );

          frames_in_period = 0;
          packets_in_period = 0;
          last_emit = Instant::now();
        }
      }
    }
  });
}

