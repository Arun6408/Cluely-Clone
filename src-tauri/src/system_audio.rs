use std::sync::{
  atomic::{AtomicBool, Ordering},
  Arc,
};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{Emitter, EventTarget};

use windows::Win32::Media::Audio::AUDCLNT_BUFFERFLAGS_SILENT;

use windows::Win32::{
  Media::Audio::{
    eConsole, eRender, IAudioCaptureClient, IAudioClient, IMMDeviceEnumerator,
    MMDeviceEnumerator, AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK,
  },
  System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED},
};

#[derive(Clone, Debug, Serialize)]
pub struct SystemAudioDebug {
  pub sample_rate: u32,
  pub frames: u64,
  pub packets: u64,
}

pub fn start_system_audio_loopback_thread(
  app_handle: tauri::AppHandle,
  stop: Arc<AtomicBool>,
) {
  std::thread::spawn(move || {
    unsafe {
      // CoInitializeEx returns an HRESULT (S_OK=0). Negative means failure.
      let hr = CoInitializeEx(None, COINIT_MULTITHREADED);
      if hr.0 < 0 {
        eprintln!("[SystemAudio] COM init failed: {:?}", hr);
        return;
      }
    }

    unsafe {
      // Default playback endpoint (what you hear in meeting apps).
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

      // Capture using the device mix format. We only need frames/packet counts for now.
      let mix_format = match audio_client.GetMixFormat() {
        Ok(f) => f,
        Err(e) => {
          eprintln!("[SystemAudio] GetMixFormat failed: {:?}", e);
          return;
        }
      };
      let sample_rate = (*mix_format).nSamplesPerSec;

      eprintln!(
        "[SystemAudio] format: {} Hz, channels={}, block_align={}",
        sample_rate,
        (*mix_format).nChannels,
        (*mix_format).nBlockAlign
      );

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

        let mut packet_size = match capture_client.GetNextPacketSize() {
          Ok(v) => v,
          Err(_) => 0,
        };

        if packet_size == 0 {
          std::thread::sleep(Duration::from_millis(3));
          continue;
        }

        while packet_size > 0 && !stop.load(Ordering::Relaxed) {
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
            let is_silent = (flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32) != 0;
        
            if is_silent {
                eprintln!("[SystemAudio] SILENT buffer: {} frames", frames);
            } else if !data_ptr.is_null() {
                let bytes_per_frame = (*mix_format).nBlockAlign as usize;
                let byte_len = frames as usize * bytes_per_frame;
        
                let slice = std::slice::from_raw_parts(data_ptr, byte_len);
        
                // Check if actual signal exists
                let has_signal = slice.iter().any(|&b| b != 0);
        
                eprintln!(
                    "[SystemAudio] AUDIO data: frames={} bytes={} signal={}",
                    frames, byte_len, has_signal
                );
            } else {
                eprintln!("[SystemAudio] NULL buffer pointer");
            }
        
            frames_in_period += frames as u64;
            packets_in_period += 1;
        }

          let _ = capture_client.ReleaseBuffer(frames);

          packet_size = match capture_client.GetNextPacketSize() {
            Ok(v) => v,
            Err(_) => 0,
          };
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

*/

/* legacy duplicate code kept by accident while iterating.
   Disabled so the compiler only uses the minimal loopback debug implementation above.
use std::sync::{
  atomic::{AtomicBool, Ordering},
  Arc,
};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{EventTarget, Emitter};

use windows::{
  Win32::{
    Media::Audio::{
      eConsole, eRender, IAudioCaptureClient, IAudioClient, IMMDeviceEnumerator,
      MMDeviceEnumerator, WAVEFORMATEX, AUDCLNT_SHAREMODE_SHARED,
      AUDCLNT_STREAMFLAGS_LOOPBACK,
    },
    System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED},
  },
};

#[derive(Clone, Debug, Serialize)]
pub struct SystemAudioDebug {
  pub sample_rate: u32,
  pub frames: u64,
  pub packets: u64,
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
      // Default playback endpoint (what you hear in meeting apps).
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
          eprintln!(
            "[SystemAudio] GetDefaultAudioEndpoint failed: {:?}",
            e
          );
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

      // We use the device mix format as the capture format. We don't need to decode audio;
      // for now we only want to verify that loopback capture receives non-zero buffers.
      let mix_format = match audio_client.GetMixFormat() {
        Ok(f) => f,
        Err(e) => {
          eprintln!("[SystemAudio] GetMixFormat failed: {:?}", e);
          return;
        }
      };
      let sample_rate = (*mix_format).nSamplesPerSec;

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

        let mut packet_size = match capture_client.GetNextPacketSize() {
          Ok(v) => v,
          Err(_) => 0,
        };

        if packet_size == 0 {
          std::thread::sleep(Duration::from_millis(10));
          continue;
        }

        while packet_size > 0 && !stop.load(Ordering::Relaxed) {
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
            frames_in_period += frames as u64;
            packets_in_period += 1;
          }

          let _ = capture_client.ReleaseBuffer(frames);

          packet_size = match capture_client.GetNextPacketSize() {
            Ok(v) => v,
            Err(_) => 0,
          };
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

} // end _legacy

use std::sync::{
  atomic::{AtomicBool, Ordering},
  Arc,
};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{Emitter, EventTarget};

use windows::{
  Win32::{
      Media::Audio::{
          eConsole, eRender, IAudioCaptureClient, IAudioClient,
          IMMDeviceEnumerator, MMDeviceEnumerator,
          AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK,
          AUDCLNT_BUFFERFLAGS_SILENT,
      },
      System::Com::{
          CoCreateInstance, CoInitializeEx, CLSCTX_ALL,
          COINIT_MULTITHREADED,
      },
  },
};

#[derive(Clone, Debug, Serialize)]
pub struct SystemAudioDebug {
  pub sample_rate: u32,
  pub frames: u64,
  pub packets: u64,
}

pub fn start_system_audio_loopback_thread(
  app_handle: tauri::AppHandle,
  stop: Arc<AtomicBool>,
) {
  std::thread::spawn(move || {
      unsafe {
          // CoInitializeEx returns an HRESULT (S_OK=0). We treat negative HRESULTs as failures.
          let hr = CoInitializeEx(None, COINIT_MULTITHREADED);
          if hr.0 < 0 {
              eprintln!("[SystemAudio] COM init failed: {:?}", hr);
              return;
          }
      }

      unsafe {
          // 1. Get default render device
          let enumerator: IMMDeviceEnumerator =
              match CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) {
                  Ok(e) => e,
                  Err(e) => {
                      eprintln!("[SystemAudio] Enumerator failed: {:?}", e);
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

          // 2. Activate Audio Client
          let audio_client: IAudioClient =
              match device.Activate(CLSCTX_ALL, None) {
                  Ok(c) => c,
                  Err(e) => {
                      eprintln!("[SystemAudio] Activate failed: {:?}", e);
                      return;
                  }
              };

          // 3. Get device mix format (IMPORTANT FIX)
          let mix_format = match audio_client.GetMixFormat() {
              Ok(f) => f,
              Err(e) => {
                  eprintln!("[SystemAudio] GetMixFormat failed: {:?}", e);
                  return;
              }
          };

          let sample_rate = (*mix_format).nSamplesPerSec;

          // 4. Initialize loopback
          if let Err(e) = audio_client.Initialize(
              AUDCLNT_SHAREMODE_SHARED,
              AUDCLNT_STREAMFLAGS_LOOPBACK,
              0, // let system decide
              0,
              mix_format,
              None,
          ) {
              eprintln!("[SystemAudio] Initialize failed: {:?}", e);
              return;
          }

          // 5. Get capture client
          let capture_client: IAudioCaptureClient =
              match audio_client.GetService() {
                  Ok(s) => s,
                  Err(e) => {
                      eprintln!("[SystemAudio] GetService failed: {:?}", e);
                      return;
                  }
              };

          if let Err(e) = audio_client.Start() {
              eprintln!("[SystemAudio] Start failed: {:?}", e);
              return;
          }

          eprintln!(
              "[SystemAudio] Loopback started | sample_rate={}",
              sample_rate
          );

          let mut frames_in_period: u64 = 0;
          let mut packets_in_period: u64 = 0;
          let mut last_emit = Instant::now();

          loop {
              if stop.load(Ordering::Relaxed) {
                  let _ = audio_client.Stop();
                  eprintln!("[SystemAudio] stopped");
                  break;
              }

              let mut packet_size =
                  capture_client.GetNextPacketSize().unwrap_or(0);

              if packet_size == 0 {
                  std::thread::sleep(Duration::from_millis(5));
                  continue;
              }

              while packet_size > 0 {
                  let mut data_ptr: *mut u8 = std::ptr::null_mut();
                  let mut frames: u32 = 0;
                  let mut flags: u32 = 0;

                  if capture_client
                      .GetBuffer(
                          &mut data_ptr,
                          &mut frames,
                          &mut flags,
                          None,
                          None,
                      )
                      .is_err()
                  {
                      break;
                  }

                  if frames > 0 {
                      if (flags & (AUDCLNT_BUFFERFLAGS_SILENT.0 as u32)) != 0 {
                          // silent buffer
                      }else if !data_ptr.is_null() {
                        let channels = (*mix_format).nChannels as usize;
                        let sample_rate = (*mix_format).nSamplesPerSec;
                        let bits_per_sample = (*mix_format).wBitsPerSample as usize;
                        let block_align = (*mix_format).nBlockAlign as usize;
                        let avg_bytes_per_sec = (*mix_format).nAvgBytesPerSec as usize;
                    
                        let byte_len = frames as usize * block_align;
                    
                        eprintln!(
                            "[SystemAudio] buffer: frames={} channels={} sample_rate={} bits_per_sample={} block_align={} bytes={} avg_bytes_per_sec={}",
                            frames,
                            channels,
                            sample_rate,
                            bits_per_sample,
                            block_align,
                            byte_len,
                            avg_bytes_per_sec
                        );
                    
                        let raw_bytes: &[u8] =
                            std::slice::from_raw_parts(data_ptr as *const u8, byte_len);
                    
                        let preview_len = raw_bytes.len().min(32);
                        eprintln!(
                            "[SystemAudio] first {} bytes = {:?}",
                            preview_len,
                            &raw_bytes[..preview_len]
                        );
                    
                        if bits_per_sample == 32 {
                            let total_samples = frames as usize * channels;
                    
                            let audio_f32: &[f32] =
                                std::slice::from_raw_parts(data_ptr as *const f32, total_samples);
                    
                            let preview_samples = audio_f32.len().min(12);
                            eprintln!(
                                "[SystemAudio] first {} f32 samples = {:?}",
                                preview_samples,
                                &audio_f32[..preview_samples]
                            );
                    
                            let mut mono: Vec<f32> = Vec::with_capacity(frames as usize);
                            for frame in audio_f32.chunks(channels) {
                                let sum: f32 = frame.iter().copied().sum();
                                mono.push(sum / channels as f32);
                            }
                    
                            let pcm16: Vec<i16> = mono
                                .iter()
                                .map(|&x| (x.clamp(-1.0, 1.0) * i16::MAX as f32) as i16)
                                .collect();
                    
                            let preview_pcm = pcm16.len().min(12);
                            eprintln!(
                                "[SystemAudio] mono samples={} pcm16 samples={} first {} pcm16 = {:?}",
                                mono.len(),
                                pcm16.len(),
                                preview_pcm,
                                &pcm16[..preview_pcm]
                            );
                    
                            // optional: write raw pcm16 to a file for debugging
                            /*
                            use std::fs::OpenOptions;
                            use std::io::Write;
                    
                            if let Ok(mut file) = OpenOptions::new()
                                .create(true)
                                .append(true)
                                .open("system_audio_debug.pcm")
                            {
                                let pcm_bytes = std::slice::from_raw_parts(
                                    pcm16.as_ptr() as *const u8,
                                    pcm16.len() * std::mem::size_of::<i16>(),
                                );
                                let _ = file.write_all(pcm_bytes);
                            }
                            */
                        } else if bits_per_sample == 16 {
                            let total_samples = frames as usize * channels;
                    
                            let audio_i16: &[i16] =
                                std::slice::from_raw_parts(data_ptr as *const i16, total_samples);
                    
                            let preview_samples = audio_i16.len().min(12);
                            eprintln!(
                                "[SystemAudio] first {} i16 samples = {:?}",
                                preview_samples,
                                &audio_i16[..preview_samples]
                            );
                    
                            let mut mono: Vec<i16> = Vec::with_capacity(frames as usize);
                            for frame in audio_i16.chunks(channels) {
                                let sum: i32 = frame.iter().map(|&v| v as i32).sum();
                                mono.push((sum / channels as i32) as i16);
                            }
                    
                            let preview_mono = mono.len().min(12);
                            eprintln!(
                                "[SystemAudio] mono samples={} first {} mono i16 = {:?}",
                                mono.len(),
                                preview_mono,
                                &mono[..preview_mono]
                            );
                        } else {
                            eprintln!(
                                "[SystemAudio] unsupported bits_per_sample={}, raw bytes only",
                                bits_per_sample
                            );
                        }
                    }

                      frames_in_period += frames as u64;
                      packets_in_period += 1;
                  }

                  let _ = capture_client.ReleaseBuffer(frames);
                  packet_size =
                      capture_client.GetNextPacketSize().unwrap_or(0);
              }

              // Emit debug every second
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