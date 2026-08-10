#include <node_api.h>
#include <roapi.h>
#include <userconsentverifierinterop.h>
#include <windows.foundation.h>
#include <windows.security.credentials.ui.h>
#include <windows.h>
#include <wrl.h>
#include <wrl/wrappers/corewrappers.h>

#include <chrono>
#include <cstring>
#include <exception>
#include <memory>
#include <string>
#include <thread>

using Microsoft::WRL::ComPtr;
using Microsoft::WRL::Wrappers::HStringReference;

namespace {

constexpr size_t kMaximumReasonLength = 120;
constexpr auto kMaximumWait = std::chrono::seconds(120);

struct VerificationWork {
  napi_async_work work = nullptr;
  napi_deferred deferred = nullptr;
  HWND window = nullptr;
  std::wstring reason;
  std::string token = "failed";
};

napi_value ThrowNapiError(
    napi_env env, napi_status status, const char* operation) {
  const napi_extended_error_info* details = nullptr;
  const napi_status details_status = napi_get_last_error_info(env, &details);
  std::string message = operation;
  if (details_status == napi_ok && details && details->error_message) {
    message.append(": ");
    message.append(details->error_message);
  } else {
    message.append(" failed with N-API status ");
    message.append(std::to_string(static_cast<int>(status)));
  }
  const napi_status throw_status =
      napi_throw_error(env, "WINDOWS_HELLO_NATIVE_NAPI_FAILURE", message.c_str());
  if (throw_status != napi_ok) return nullptr;
  return nullptr;
}

napi_value ThrowTypeError(napi_env env, const char* message) {
  const napi_status status = napi_throw_type_error(env, nullptr, message);
  if (status != napi_ok) return ThrowNapiError(env, status, "napi_throw_type_error");
  return nullptr;
}

napi_value ThrowNativeError(napi_env env, const char* message) {
  const napi_status status =
      napi_throw_error(env, "WINDOWS_HELLO_NATIVE_FAILURE", message);
  if (status != napi_ok) return ThrowNapiError(env, status, "napi_throw_error");
  return nullptr;
}

void ReportAsyncNapiError(napi_env env, napi_status status, const char* operation) {
  if (status == napi_ok) return;
  const napi_status throw_status =
      napi_throw_error(env, "WINDOWS_HELLO_NATIVE_NAPI_FAILURE", operation);
  if (throw_status != napi_ok) return;
}

void SetResultToken(
    VerificationWork* work,
    ABI::Windows::Security::Credentials::UI::UserConsentVerificationResult result) {
  switch (result) {
    case ABI::Windows::Security::Credentials::UI::
        UserConsentVerificationResult_Verified:
      work->token = "verified";
      break;
    case ABI::Windows::Security::Credentials::UI::
        UserConsentVerificationResult_Canceled:
      work->token = "canceled";
      break;
    case ABI::Windows::Security::Credentials::UI::
        UserConsentVerificationResult_DeviceBusy:
      work->token = "device-busy";
      break;
    case ABI::Windows::Security::Credentials::UI::
        UserConsentVerificationResult_RetriesExhausted:
      work->token = "retries-exhausted";
      break;
    case ABI::Windows::Security::Credentials::UI::
        UserConsentVerificationResult_DeviceNotPresent:
      work->token = "device-not-present";
      break;
    case ABI::Windows::Security::Credentials::UI::
        UserConsentVerificationResult_NotConfiguredForUser:
      work->token = "not-configured";
      break;
    case ABI::Windows::Security::Credentials::UI::
        UserConsentVerificationResult_DisabledByPolicy:
      work->token = "disabled-by-policy";
      break;
    default:
      work->token = "failed";
      break;
  }
}

void ExecuteVerification(napi_env, void* data) {
  auto* work = static_cast<VerificationWork*>(data);
  if (!work || !IsWindow(work->window)) {
    if (work) work->token = "invalid-window";
    return;
  }

  DWORD owner_process_id = 0;
  GetWindowThreadProcessId(work->window, &owner_process_id);
  if (
      owner_process_id == 0 ||
      owner_process_id != GetCurrentProcessId()) {
    work->token = "invalid-window";
    return;
  }

  const HRESULT initialized = RoInitialize(RO_INIT_MULTITHREADED);
  const bool should_uninitialize = SUCCEEDED(initialized);
  if (FAILED(initialized) && initialized != RPC_E_CHANGED_MODE) {
    work->token = "failed";
    return;
  }

  ComPtr<IUserConsentVerifierInterop> interop;
  HRESULT hr = RoGetActivationFactory(
      HStringReference(
          RuntimeClass_Windows_Security_Credentials_UI_UserConsentVerifier)
          .Get(),
      IID_PPV_ARGS(&interop));
  if (FAILED(hr)) {
    work->token = "unsupported";
    if (should_uninitialize) RoUninitialize();
    return;
  }

  using AsyncOperation = ABI::Windows::Foundation::IAsyncOperation<
      ABI::Windows::Security::Credentials::UI::UserConsentVerificationResult>;
  ComPtr<AsyncOperation> operation;
  hr = interop->RequestVerificationForWindowAsync(
      work->window,
      HStringReference(work->reason.c_str()).Get(),
      IID_PPV_ARGS(&operation));
  if (FAILED(hr)) {
    work->token = "failed";
    if (should_uninitialize) RoUninitialize();
    return;
  }

  ComPtr<ABI::Windows::Foundation::IAsyncInfo> info;
  hr = operation.As(&info);
  if (FAILED(hr)) {
    work->token = "failed";
    if (should_uninitialize) RoUninitialize();
    return;
  }

  const auto deadline = std::chrono::steady_clock::now() + kMaximumWait;
  ABI::Windows::Foundation::AsyncStatus status =
      ABI::Windows::Foundation::AsyncStatus::Started;
  while (std::chrono::steady_clock::now() < deadline) {
    if (FAILED(info->get_Status(&status))) {
      work->token = "failed";
      break;
    }
    if (status != ABI::Windows::Foundation::AsyncStatus::Started) break;
    std::this_thread::sleep_for(std::chrono::milliseconds(25));
  }

  if (status == ABI::Windows::Foundation::AsyncStatus::Started) {
    info->Cancel();
    work->token = "timeout";
  } else if (status == ABI::Windows::Foundation::AsyncStatus::Completed) {
    ABI::Windows::Security::Credentials::UI::UserConsentVerificationResult result;
    if (SUCCEEDED(operation->GetResults(&result))) SetResultToken(work, result);
  } else if (status == ABI::Windows::Foundation::AsyncStatus::Canceled) {
    work->token = "canceled";
  } else {
    work->token = "failed";
  }

  if (should_uninitialize) RoUninitialize();
}

void CompleteVerification(napi_env env, napi_status status, void* data) {
  auto* work = static_cast<VerificationWork*>(data);
  if (!work) return;
  if (status != napi_ok) work->token = "failed";

  napi_value result = nullptr;
  const napi_status value_status =
      napi_create_string_utf8(
          env, work->token.c_str(), work->token.size(), &result);
  if (value_status == napi_ok) {
    const napi_status resolve_status =
        napi_resolve_deferred(env, work->deferred, result);
    ReportAsyncNapiError(env, resolve_status, "napi_resolve_deferred failed");
  } else {
    ReportAsyncNapiError(env, value_status, "napi_create_string_utf8 failed");
  }
  const napi_status delete_status = napi_delete_async_work(env, work->work);
  ReportAsyncNapiError(env, delete_status, "napi_delete_async_work failed");
  delete work;
}

napi_value VerifyForWindow(napi_env env, napi_callback_info info) {
  try {
    size_t argc = 2;
    napi_value args[2] = {nullptr, nullptr};
    napi_status napi_result =
        napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
    if (napi_result != napi_ok) {
      return ThrowNapiError(env, napi_result, "napi_get_cb_info");
    }
    if (argc != 2) {
      return ThrowTypeError(env, "Expected HWND buffer and reason.");
    }

    bool is_buffer = false;
    napi_result = napi_is_buffer(env, args[0], &is_buffer);
    if (napi_result != napi_ok) {
      return ThrowNapiError(env, napi_result, "napi_is_buffer");
    }
    if (!is_buffer) return ThrowTypeError(env, "HWND must be a Buffer.");
    void* handle_data = nullptr;
    size_t handle_length = 0;
    napi_result =
        napi_get_buffer_info(env, args[0], &handle_data, &handle_length);
    if (napi_result != napi_ok) {
      return ThrowNapiError(env, napi_result, "napi_get_buffer_info");
    }
    if (!handle_data || handle_length != sizeof(HWND)) {
      return ThrowTypeError(env, "HWND buffer has an invalid size.");
    }

    napi_valuetype reason_type = napi_undefined;
    napi_result = napi_typeof(env, args[1], &reason_type);
    if (napi_result != napi_ok) {
      return ThrowNapiError(env, napi_result, "napi_typeof");
    }
    if (reason_type != napi_string) {
      return ThrowTypeError(env, "Reason must be a string.");
    }
    size_t reason_length = 0;
    napi_result =
        napi_get_value_string_utf16(env, args[1], nullptr, 0, &reason_length);
    if (napi_result != napi_ok) {
      return ThrowNapiError(
          env, napi_result, "napi_get_value_string_utf16 length");
    }
    if (reason_length == 0 || reason_length > kMaximumReasonLength) {
      return ThrowTypeError(env, "Reason length is invalid.");
    }
    std::u16string utf16(reason_length + 1, u'\0');
    size_t copied = 0;
    napi_result = napi_get_value_string_utf16(
        env,
        args[1],
        utf16.data(),
        utf16.size(),
        &copied);
    if (napi_result != napi_ok) {
      return ThrowNapiError(env, napi_result, "napi_get_value_string_utf16");
    }
    if (copied != reason_length) {
      return ThrowNativeError(env, "Reason length changed during native conversion.");
    }
    for (size_t index = 0; index < copied; ++index) {
      const char16_t character = utf16[index];
      if (character < 0x20 || character == 0x7f) {
        return ThrowTypeError(env, "Reason contains a control character.");
      }
    }

    auto work = std::make_unique<VerificationWork>();
    std::memcpy(&work->window, handle_data, sizeof(HWND));
    work->reason.assign(
        reinterpret_cast<const wchar_t*>(utf16.data()), copied);

    napi_value promise = nullptr;
    napi_result = napi_create_promise(env, &work->deferred, &promise);
    if (napi_result != napi_ok) {
      return ThrowNapiError(env, napi_result, "napi_create_promise");
    }
    napi_value resource_name = nullptr;
    napi_result = napi_create_string_utf8(
        env, "AMZ.API Windows Hello", NAPI_AUTO_LENGTH, &resource_name);
    if (napi_result != napi_ok) {
      return ThrowNapiError(env, napi_result, "napi_create_string_utf8");
    }
    napi_result = napi_create_async_work(
        env,
        nullptr,
        resource_name,
        ExecuteVerification,
        CompleteVerification,
        work.get(),
        &work->work);
    if (napi_result != napi_ok) {
      return ThrowNapiError(env, napi_result, "napi_create_async_work");
    }
    napi_result = napi_queue_async_work(env, work->work);
    if (napi_result != napi_ok) {
      const napi_status delete_status = napi_delete_async_work(env, work->work);
      if (delete_status != napi_ok) {
        return ThrowNapiError(
            env, delete_status, "napi_delete_async_work after queue failure");
      }
      return ThrowNapiError(env, napi_result, "napi_queue_async_work");
    }
    work.release();
    return promise;
  } catch (const std::exception&) {
    return ThrowNativeError(env, "Windows Hello native setup failed.");
  } catch (...) {
    return ThrowNativeError(env, "Windows Hello native setup failed.");
  }
}

napi_value Initialize(napi_env env, napi_value exports) {
  napi_property_descriptor property = {
      "verifyForWindow", nullptr, VerifyForWindow, nullptr, nullptr, nullptr,
      napi_default, nullptr};
  const napi_status status = napi_define_properties(env, exports, 1, &property);
  if (status != napi_ok) {
    return ThrowNapiError(env, status, "napi_define_properties");
  }
  return exports;
}

}  // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, Initialize)
