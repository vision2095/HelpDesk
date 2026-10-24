#include "../include/d3d11_renderer.hpp"

namespace LensDesk {

D3D11Renderer::D3D11Renderer() = default;

D3D11Renderer::~D3D11Renderer() {
    Shutdown();
}

bool D3D11Renderer::Initialize(HWND hwnd, int width, int height) {
    m_width = width;
    m_height = height;

    if (!CreateDeviceAndSwapChain(hwnd, width, height)) {
        return false;
    }

    if (!CreateRenderTarget()) {
        return false;
    }

    // Configure alpha blending state for transparent composition
    D3D11_BLEND_DESC blendDesc{};
    blendDesc.AlphaToCoverageEnable = FALSE;
    blendDesc.IndependentBlendEnable = FALSE;
    blendDesc.RenderTarget[0].BlendEnable = TRUE;
    blendDesc.RenderTarget[0].SrcBlend = D3D11_BLEND_ONE;
    blendDesc.RenderTarget[0].DestBlend = D3D11_BLEND_INV_SRC_ALPHA;
    blendDesc.RenderTarget[0].BlendOp = D3D11_BLEND_OP_ADD;
    blendDesc.RenderTarget[0].SrcBlendAlpha = D3D11_BLEND_ONE;
    blendDesc.RenderTarget[0].DestBlendAlpha = D3D11_BLEND_INV_SRC_ALPHA;
    blendDesc.RenderTarget[0].BlendOpAlpha = D3D11_BLEND_OP_ADD;
    blendDesc.RenderTarget[0].RenderTargetWriteMask = D3D11_COLOR_WRITE_ENABLE_ALL;

    m_device->CreateBlendState(&blendDesc, &m_blendState);

    return true;
}

void D3D11Renderer::Shutdown() {
    CleanupRenderTarget();
    m_blendState.Reset();
    m_swapChain.Reset();
    m_context.Reset();
    m_device.Reset();
}

bool D3D11Renderer::CreateDeviceAndSwapChain(HWND hwnd, int width, int height) {
    UINT createDeviceFlags = D3D11_CREATE_DEVICE_BGRA_SUPPORT;
#if defined(_DEBUG)
    createDeviceFlags |= D3D11_CREATE_DEVICE_DEBUG;
#endif

    D3D_FEATURE_LEVEL featureLevels[] = {
        D3D_FEATURE_LEVEL_11_1,
        D3D_FEATURE_LEVEL_11_0,
        D3D_FEATURE_LEVEL_10_1,
        D3D_FEATURE_LEVEL_10_0,
    };
    D3D_FEATURE_LEVEL featureLevel;

    HRESULT hr = D3D11CreateDevice(
        nullptr,
        D3D_DRIVER_TYPE_HARDWARE,
        nullptr,
        createDeviceFlags,
        featureLevels,
        ARRAYSIZE(featureLevels),
        D3D11_SDK_VERSION,
        &m_device,
        &featureLevel,
        &m_context
    );

    if (FAILED(hr)) {
        // Fallback to WARP software rasterizer if hardware is unavailable
        hr = D3D11CreateDevice(
            nullptr,
            D3D_DRIVER_TYPE_WARP,
            nullptr,
            createDeviceFlags,
            featureLevels,
            ARRAYSIZE(featureLevels),
            D3D11_SDK_VERSION,
            &m_device,
            &featureLevel,
            &m_context
        );
        if (FAILED(hr)) return false;
    }

    // Query DXGI Factory to create composition swapchain
    ComPtr<IDXGIDevice> dxgiDevice;
    hr = m_device.As(&dxgiDevice);
    if (FAILED(hr)) return false;

    ComPtr<IDXGIAdapter> dxgiAdapter;
    hr = dxgiDevice->GetAdapter(&dxgiAdapter);
    if (FAILED(hr)) return false;

    ComPtr<IDXGIFactory2> dxgiFactory;
    hr = dxgiAdapter->GetParent(IID_PPV_ARGS(&dxgiFactory));
    if (FAILED(hr)) return false;

    DXGI_SWAP_CHAIN_DESC1 scd{};
    scd.Width = width > 0 ? width : 1040;
    scd.Height = height > 0 ? height : 740;
    scd.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
    scd.Stereo = FALSE;
    scd.SampleDesc.Count = 1;
    scd.SampleDesc.Quality = 0;
    scd.BufferUsage = DXGI_USAGE_RENDER_TARGET_OUTPUT;
    scd.BufferCount = 2;
    scd.Scaling = DXGI_SCALING_STRETCH;
    scd.SwapEffect = DXGI_SWAP_EFFECT_FLIP_DISCARD;
    scd.AlphaMode = DXGI_ALPHA_MODE_PREMULTIPLIED; // True transparency support
    scd.Flags = 0;

    hr = dxgiFactory->CreateSwapChainForComposition(
        m_device.Get(),
        &scd,
        nullptr,
        &m_swapChain
    );

    return SUCCEEDED(hr);
}

bool D3D11Renderer::CreateRenderTarget() {
    ComPtr<ID3D11Texture2D> backBuffer;
    HRESULT hr = m_swapChain->GetBuffer(0, IID_PPV_ARGS(&backBuffer));
    if (FAILED(hr)) return false;

    D3D11_RENDER_TARGET_VIEW_DESC rtvDesc{};
    rtvDesc.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
    rtvDesc.ViewDimension = D3D11_RTV_DIMENSION_TEXTURE2D;

    hr = m_device->CreateRenderTargetView(backBuffer.Get(), &rtvDesc, &m_renderTargetView);
    return SUCCEEDED(hr);
}

void D3D11Renderer::CleanupRenderTarget() {
    if (m_context) {
        ID3D11RenderTargetView* nullViews[] = { nullptr };
        m_context->OMSetRenderTargets(1, nullViews, nullptr);
    }
    m_renderTargetView.Reset();
}

void D3D11Renderer::Resize(int width, int height) {
    if (width <= 0 || height <= 0 || !m_swapChain) return;
    if (m_width == width && m_height == height) return;

    m_width = width;
    m_height = height;

    CleanupRenderTarget();

    HRESULT hr = m_swapChain->ResizeBuffers(0, width, height, DXGI_FORMAT_UNKNOWN, 0);
    if (SUCCEEDED(hr)) {
        CreateRenderTarget();
    }
}

void D3D11Renderer::BeginFrame() {
    if (!m_context || !m_renderTargetView) return;

    // Viewport
    D3D11_VIEWPORT vp{};
    vp.Width = static_cast<float>(m_width);
    vp.Height = static_cast<float>(m_height);
    vp.MinDepth = 0.0f;
    vp.MaxDepth = 1.0f;
    vp.TopLeftX = 0;
    vp.TopLeftY = 0;
    m_context->RSSetViewports(1, &vp);

    // Bind render target
    ID3D11RenderTargetView* rtv[] = { m_renderTargetView.Get() };
    m_context->OMSetRenderTargets(1, rtv, nullptr);

    // Clear to 100% transparent black
    const float clearColor[4] = { 0.0f, 0.0f, 0.0f, 0.0f };
    m_context->ClearRenderTargetView(m_renderTargetView.Get(), clearColor);

    // Enable alpha blend
    if (m_blendState) {
        const float blendFactor[4] = { 0.f, 0.f, 0.f, 0.f };
        m_context->OMSetBlendState(m_blendState.Get(), blendFactor, 0xffffffff);
    }
}

void D3D11Renderer::EndFrame() {
    if (m_swapChain) {
        m_swapChain->Present(1, 0);
    }
}

} // namespace LensDesk
