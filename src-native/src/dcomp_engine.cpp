#include "../include/dcomp_engine.hpp"

namespace LensDesk {

DCompEngine::DCompEngine() = default;

DCompEngine::~DCompEngine() {
    Shutdown();
}

bool DCompEngine::Initialize(HWND hwnd, ID3D11Device* d3dDevice, IDXGISwapChain1* swapChain) {
    if (!hwnd || !d3dDevice || !swapChain) return false;

    // 1. Query IDXGIDevice
    ComPtr<IDXGIDevice> dxgiDevice;
    HRESULT hr = d3dDevice->QueryInterface(IID_PPV_ARGS(&dxgiDevice));
    if (FAILED(hr)) return false;

    // 2. Create DirectComposition Device
    hr = DCompositionCreateDevice(dxgiDevice.Get(), __uuidof(IDCompositionDevice), &m_dcompDevice);
    if (FAILED(hr)) return false;

    // 3. Create Composition Target for HWND
    hr = m_dcompDevice->CreateTargetForHwnd(hwnd, TRUE, &m_dcompTarget);
    if (FAILED(hr)) return false;

    // 4. Create Root Visual
    hr = m_dcompDevice->CreateVisual(&m_rootVisual);
    if (FAILED(hr)) return false;
    m_dcompTarget->SetRoot(m_rootVisual.Get());

    // 5. Create D3D / ImGui Visual (hosts swap chain)
    hr = m_dcompDevice->CreateVisual(&m_d3dVisual);
    if (FAILED(hr)) return false;
    m_d3dVisual->SetContent(swapChain);
    m_rootVisual->AddVisual(m_d3dVisual.Get(), FALSE, nullptr);

    // 6. Create HUD WebView2 Visual (hosts React 19 UI)
    hr = m_dcompDevice->CreateVisual(&m_hudVisual);
    if (FAILED(hr)) return false;
    m_rootVisual->AddVisual(m_hudVisual.Get(), TRUE, m_d3dVisual.Get());

    // 7. Create Browser WebView2 Visual (hosts embedded web browser tabs)
    hr = m_dcompDevice->CreateVisual(&m_browserVisual);
    if (FAILED(hr)) return false;
    m_rootVisual->AddVisual(m_browserVisual.Get(), TRUE, m_hudVisual.Get());

    Commit();
    return true;
}

void DCompEngine::Shutdown() {
    if (m_dcompTarget) {
        m_dcompTarget->SetRoot(nullptr);
    }
    m_browserVisual.Reset();
    m_hudVisual.Reset();
    m_d3dVisual.Reset();
    m_rootVisual.Reset();
    m_dcompTarget.Reset();
    m_dcompDevice.Reset();
}

void DCompEngine::Commit() {
    if (m_dcompDevice) {
        m_dcompDevice->Commit();
    }
}

void DCompEngine::SetHudVisualBounds(float x, float y, float width, float height) {
    if (!m_hudVisual) return;
    m_hudVisual->SetOffsetX(x);
    m_hudVisual->SetOffsetY(y);
    Commit();
}

void DCompEngine::SetBrowserVisualBounds(float x, float y, float width, float height) {
    if (!m_browserVisual) return;
    m_browserVisual->SetOffsetX(x);
    m_browserVisual->SetOffsetY(y);
    Commit();
}

void DCompEngine::SetBrowserVisualVisible(bool visible) {
    if (m_browserVisible == visible || !m_rootVisual || !m_browserVisual) return;
    m_browserVisible = visible;
    if (visible) {
        m_rootVisual->AddVisual(m_browserVisual.Get(), TRUE, m_hudVisual.Get());
    } else {
        m_rootVisual->RemoveVisual(m_browserVisual.Get());
    }
    Commit();
}

} // namespace LensDesk
