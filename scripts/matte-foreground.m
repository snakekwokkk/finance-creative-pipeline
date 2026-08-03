#import <CoreImage/CoreImage.h>
#import <Foundation/Foundation.h>
#import <ImageIO/ImageIO.h>
#import <Vision/Vision.h>

static int fail(NSString *message) {
    fprintf(stderr, "%s\n", message.UTF8String);
    return 1;
}

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (argc != 3) return fail(@"用法：matte-foreground INPUT OUTPUT");
        NSURL *inputURL = [NSURL fileURLWithPath:[NSString stringWithUTF8String:argv[1]]];
        NSURL *outputURL = [NSURL fileURLWithPath:[NSString stringWithUTF8String:argv[2]]];
        CGImageSourceRef source = CGImageSourceCreateWithURL((__bridge CFURLRef)inputURL, NULL);
        if (!source) return fail(@"无法读取待抠图图片");
        CGImageRef image = CGImageSourceCreateImageAtIndex(source, 0, NULL);
        CFRelease(source);
        if (!image) return fail(@"无法解码待抠图图片");

        NSError *error = nil;
        VNImageRequestHandler *handler = [[VNImageRequestHandler alloc] initWithCGImage:image options:@{}];
        VNGenerateForegroundInstanceMaskRequest *request = [VNGenerateForegroundInstanceMaskRequest new];
        if (![handler performRequests:@[request] error:&error]) {
            CGImageRelease(image);
            return fail(error.localizedDescription ?: @"Apple Vision 前景识别失败");
        }
        VNInstanceMaskObservation *observation = request.results.firstObject;
        if (!observation || observation.allInstances.count == 0) {
            CGImageRelease(image);
            return fail(@"Apple Vision 未识别到可靠前景实例");
        }

        CVPixelBufferRef maskBuffer = [observation generateScaledMaskForImageForInstances:observation.allInstances
                                                                        fromRequestHandler:handler
                                                                                     error:&error];
        if (!maskBuffer) {
            CGImageRelease(image);
            return fail(error.localizedDescription ?: @"无法生成前景蒙版");
        }

        CIImage *inputImage = [CIImage imageWithCGImage:image];
        CIImage *maskImage = [CIImage imageWithCVPixelBuffer:maskBuffer];
        CIImage *transparent = [[CIImage imageWithColor:CIColor.clearColor] imageByCroppingToRect:inputImage.extent];
        CIFilter *filter = [CIFilter filterWithName:@"CIBlendWithMask"];
        [filter setValue:inputImage forKey:kCIInputImageKey];
        [filter setValue:transparent forKey:kCIInputBackgroundImageKey];
        [filter setValue:maskImage forKey:kCIInputMaskImageKey];
        CIImage *outputImage = [filter.outputImage imageByCroppingToRect:inputImage.extent];
        if (!outputImage) {
            CVPixelBufferRelease(maskBuffer);
            CGImageRelease(image);
            return fail(@"无法渲染透明前景 PNG");
        }

        CIContext *context = [CIContext contextWithOptions:@{kCIContextCacheIntermediates: @YES}];
        CGColorSpaceRef colorSpace = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
        BOOL wrote = [context writePNGRepresentationOfImage:outputImage
                                                      toURL:outputURL
                                                     format:kCIFormatRGBA8
                                                 colorSpace:colorSpace
                                                    options:@{}
                                                      error:&error];
        CGColorSpaceRelease(colorSpace);
        CVPixelBufferRelease(maskBuffer);
        size_t width = CGImageGetWidth(image);
        size_t height = CGImageGetHeight(image);
        CGImageRelease(image);
        if (!wrote) return fail(error.localizedDescription ?: @"无法写入透明前景 PNG");

        NSDictionary *result = @{
            @"engine": @"apple-vision-foreground-instance-mask",
            @"instanceCount": @(observation.allInstances.count),
            @"width": @(width),
            @"height": @(height)
        };
        NSData *json = [NSJSONSerialization dataWithJSONObject:result options:0 error:&error];
        if (!json) return fail(error.localizedDescription ?: @"无法输出抠图报告");
        printf("%s\n", [[[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding] UTF8String]);
        return 0;
    }
}
