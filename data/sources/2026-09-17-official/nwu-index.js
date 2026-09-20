$(function () {

        // --------------------------------------------------------就业管理input
        $(".form-group input").focus(function () {
            if ($(this).hasClass("readonly")) {
    
            }else if($(this).attr("readonly")=="readonly"){
    
            }else if($(this).attr("readonly")==true){
    
            } else {
                if ($(this).val() == "暂无数据" || $(this).val() == "请填写是或否" || $(this).val() == "请以X省X市县区X街道镇乡X村路门牌号的格式填写") {
                    $(this).val("");
                }
            }
        })
        
        $(".form-group input").blur(function () {
            if($("#is_jiandanglika").val() == ""){
                $(this).val("请填写是或否");
            }
            if($("#address").val() == ""){
                $(this).val("请以X省X市县区X街道镇乡X村路门牌号的格式填写");
            }
            if ($(this).val() == "") {
                $(this).val("暂无数据");
            }
        })
        
        // ----------------------------------工商查询
        $(".gongshang").hover(function(){
            $(this).stop().animate({"background-color":"#25650e","color":"#fff"})
        },function(){
            $(this).stop().animate({"background-color":"#64a44e","color":"#fff"})
        })

    
    // ----------------------------------------新闻公告点击切换
    $(".news_t>span").hover(function(){
        var index = $(this).index();
        var aid = $(this).attr("aid");
        $(".news_bottom .news_bot").eq(index).stop().fadeIn().siblings().hide();
        $(this).addClass("bgcolor").addClass("fcolor1").siblings().removeClass("bgcolor").removeClass("fcolor1");
        $(this).find("i").show().parent().siblings().find("i").hide();
        $(this).parent().parent().find("."+aid+"__").show().siblings("a").hide();
    })

    $(".news_bot .inform a").click(function(){
        var aa=$(this).attr("aa");
        $(this).addClass("fcolor").siblings().removeClass("fcolor");
        $(this).parent().parent().find("."+aa+"_").show().siblings("ul").hide();
        $(this).parent().parent().parent().parent().find("."+aa+"__").show().siblings("a").hide();
        // $(this).parent().parent().parent().siblings().find("."+aa+"_").stop().fadeIn().siblings("ul").css("display","none");
        // $(this).parent().parent().parent().parent().siblings().prev().find("."+aa+"__").css("display","block").siblings("a").css("display","none");
    })
    
    // ----------------------------------------双选会 宣讲会点击切换
    $(".tab_news span").hover(function () {
        var index = $(this).index();
        $(this).addClass("bgcolor").css("color", "#fff").siblings("span").removeClass("bgcolor").css("color", "#3C84E8");
        $(this).find("i").css('display','block').parent().siblings("span").find("i").css('display','none');
        $(this).parent().find(".right").eq(index).stop().css('display','block').siblings(".right").css('display','none');
        $(".sx_bottom").eq(index).stop().fadeIn().siblings(".sx_bottom").hide();
    })

    $.fn.xuanlunbo = function (isLeftAndRight) {
        var that = $(this);
        var ul = that.find("ul");
        ul.append(ul.find("li").eq(0).clone());
        var imgWidth = ul.find("li").eq(0).width();
        var count = ul.find("li").size();
        var imgIndex = 0;
        var timer = setInterval(autoPlay, 4000);
        function autoPlay() {
            imgIndex++;
            if (imgIndex > count - 1) {
                ul.stop().animate({
                    left: 0
                }, 0);
                imgIndex = 1;
            }
            ul.stop().animate({
                left: -imgIndex * imgWidth
            }, 600);
        }
        that.parent().mouseenter(function () {
            clearInterval(timer);
        });
        that.parent().mouseleave(function () {
            timer = setInterval(autoPlay, 4000);
        });
        if (isLeftAndRight) {
            //左按钮
            that.parent().find(".btn").eq(0).click(function () {
                $(this).css("outline", "none");
                imgIndex--;
                if (imgIndex < 0) {
                    ul.stop().animate({
                        left: -(count - 1) * imgWidth
                    }, 0);
                    imgIndex = count - 2;
                }
                ul.stop().animate({
                    left: -imgIndex * imgWidth
                }, 600);
            })
            //右按钮
            that.parent().find(".btn").eq(1).click(function () {
                $(this).css("outline", "none");
                autoPlay();
            })
        }
    }
    
    // var $h_ = $(".sx_bottom>li .right").height();
    // $(".sx_bottom>li").css("height", $h_ + "px");
    // $(".sx_bottom").css("height", $h_ + "px");
    // ----------------------------------右侧固定
    $(".wei").hover(function () {
        $(this).find("img").attr("src", "../image/weih.png");
        $(this).find(".big").show().stop().animate({
            "left": "-139px",
            "opacity": "1"
        }, 400)
    }, function () {
        $(this).find("img").attr("src", "../image/weihui.png");
        $(this).find(".big").hide().stop().animate({
            "left": "-300px",
            "opacity": "0"
        }, 400)
    })
    $(".qq").hover(function () {
        $(this).find("p").stop().fadeIn(500);
        $(this).find("img").attr("src", "../image/qqh.png");
    }, function () {
        $(this).find("p").stop().fadeOut(500);
        $(this).find("img").attr("src", "../image/qqhui.png");
    })
    $(".xin").hover(function () {
        $(this).find("p").stop().fadeIn(500);
        $(this).find("img").attr("src", "../image/xinh.png");
    }, function () {
        $(this).find("p").stop().fadeOut(500);
        $(this).find("img").attr("src", "../image/xinhui.png");
    })
    // -----------------------------------分享
    // $('.share').shareConfig({
    //     Shade : true, //是否显示遮罩层
    //     Event:'click', //触发事件
    //     Content : 'Share', //内容DIV ID
    //     Title : '分享' //显示标题
    // });

    // ---------------------------------------用人单位推荐
    $(".comp_tab>span").hover(function(){
        var index = $(this).index();
        $(".contain_tab .cont_txt").eq(index).show().siblings().hide();
        $(this).addClass("bgcolor").addClass("fcolor1").siblings("span").removeClass("bgcolor").removeClass("fcolor1");
        $(".comp_tab>a").eq(index).show().siblings("a").hide();
        $(this).find("i").show().parent().siblings().find("i").hide();
    })

    $.fn.lunbo=function(className,isFocus,isLeftAndRight){
        var that=$(this);
        var ul=that.find("ul");
        ul.append(ul.find("li").eq(0).clone());
        var imgWidth=ul.find("li").eq(0).width();
        var count=ul.find("li").size();
        var imgIndex=0;
        var timer=setInterval(autoPlay,4000);
        for(var i=0;i<count-1;i++){
            that.parent().find("ol").append("<li></li>");
        }
        that.parent().find("ol li").eq(0).addClass(className).siblings().removeClass(className);
        if(isFocus){
            var currentIndex=0;
        }
        function autoPlay(){
            imgIndex++;
            if(imgIndex>count-1){
                ul.stop().animate({left:0},0);
                imgIndex=1;
            }
            ul.stop().animate({left:-imgIndex*imgWidth},600);
            if(isFocus){
                currentIndex++;
                if(currentIndex>that.parent().find("ol li").size()-1){
                    currentIndex=0;
                }
                that.parent().find("ol li").eq(currentIndex).addClass(className).siblings().removeClass(className);
            }
        }
        that.parent().mouseenter(function(){
            clearInterval(timer);
        });
        that.parent().mouseleave(function(){
            timer=setInterval(autoPlay,4000);
        });
        if(isFocus){
            that.parent().find("ol li").mouseenter(function(){
                imgIndex=currentIndex=$(this).index()-1;
                autoPlay();
            })
        };
        if(isLeftAndRight){
            //左按钮
            that.parent().find(".btn").eq(0).click(function(){
                $(this).css("outline","none");
                imgIndex--;
                if(imgIndex<0){
                    ul.stop().animate({left:-(count-1)*imgWidth},0);
                    imgIndex=count-2;
                }
                ul.stop().animate({left:-imgIndex*imgWidth},600);
                if(isFocus){
                    currentIndex--;
                    if(currentIndex<0){
                        currentIndex=that.parent().find("ol li").size()-1;
                    }
                    that.parent().find("ol li").eq(currentIndex).addClass(className).siblings().removeClass(className);
                }
            })
            //右按钮
            that.parent().find(".btn").eq(1).click(function(){
                $(this).css("outline","none");
                autoPlay();
            })
        }
    }

    
})